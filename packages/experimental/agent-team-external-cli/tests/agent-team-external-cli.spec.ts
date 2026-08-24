import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { type ContentBlock } from '@deepseek-ai/dsh-llm'
import { type SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TeamService, { foldTeam } from '@deepseek-ai/dsh-experimental-agent-team'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ExternalCliTeam from '../src/index.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function content(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function assistantTextFrom(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event =>
    event.type === 'assistant/message'
      ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
}

function assistantText(agent: Agent): string[] {
  return assistantTextFrom(agent.session.events)
}

function records(path: string): Array<{ argv: string[]; prompt: string }> {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { argv: string[]; prompt: string })
}

function fakeCli(root: string): { command: string; log: string } {
  const command = join(root, 'fake-claude.mjs')
  const log = join(root, 'cli.jsonl')
  writeFileSync(command, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
const log = process.env.CLI_LOG
const prompt = process.argv.find(arg => arg.startsWith('-p='))?.slice(3) ?? process.argv.at(-1) ?? ''
appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), prompt }) + '\\n')
if (process.env.CLI_HANG === '1') {
  process.on('SIGTERM', () => {
    appendFileSync(log, JSON.stringify({ terminated: true }) + '\\n')
    process.exit(0)
  })
  setInterval(() => {}, 1000)
} else if (process.env.CLI_FAIL === '1') {
  console.error('fake cli failed')
  process.exit(7)
} else {
  console.log('fake reply: ' + (prompt.includes('follow-up') ? 'follow-up seen' : 'initial seen'))
}
`)
  chmodSync(command, 0o755)
  return { command, log }
}

async function setup(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-external-cli-team-'))
  roots.push(root)
  const cwd = join(root, 'workspace')
  mkdirSync(cwd)
  const cli = fakeCli(root)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(TeamService)
  const cliFiber = await ctx.plugin(ExternalCliTeam, {
    providerName: 'claude-team',
    command: cli.command,
    env: { CLI_LOG: cli.log, ...env },
    disposeGraceMs: 50,
  })
  const lead = ctx.agentLoop.create(SessionId('lead'), { provider: 'unused', model: 'unused' }, { cwd })
  return { ctx, lead, cli, cliFiber }
}

async function spawnExternal(ctx: Context, lead: Agent) {
  return await ctx.agentTeams.spawnTeammate(lead, {
    name: 'claude-worker',
    description: 'Claude worker',
    prompt: content('initial assignment'),
    context: 'fresh',
    provider: 'claude-team',
    signal: SIGNAL,
  })
}

async function live(ctx: Context, id: SessionId): Promise<Agent> {
  return await vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent).toBeDefined()
    return agent!
  }, { timeout: 5_000 })
}

describe('Agent Team external CLI bridge', () => {
  it('seats an external CLI provider as a normal Team member', async () => {
    const { ctx, lead } = await setup()

    const started = await spawnExternal(ctx, lead)
    const worker = await live(ctx, started.member.id)
    await worker.whenIdle()

    expect(ctx.agentTeams.listMembers(lead).map(member => [member.name, member.provider]))
      .toContainEqual(['claude-worker', 'claude-team'])
    expect(foldTeam(lead.id, lead.session.events).members.get(started.member.id)?.phase).toBe('active')
  })

  it('delivers Team mail to the CLI and records its reply on the teammate log', async () => {
    const { ctx, lead, cli } = await setup()
    const started = await spawnExternal(ctx, lead)
    const worker = await live(ctx, started.member.id)
    await worker.whenIdle()

    const sent = await ctx.agentTeams.sendMessage(lead, {
      target: 'claude-worker',
      content: content('follow-up question'),
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    await vi.waitFor(() => {
      expect(foldTeam(lead.id, lead.session.events).delivered.has(sent.messageId)).toBe(true)
    }, { timeout: 5_000 })
    await vi.waitFor(() => {
      expect(records(cli.log)).toHaveLength(2)
    }, { timeout: 5_000 })
    const stored = await vi.waitFor(async () => {
      const latest = await ctx.sessionPersistence.inspect(worker.id)
      expect(assistantTextFrom(latest.events)).toHaveLength(2)
      return latest
    }, { timeout: 5_000 })

    expect(['accepted', 'queued']).toContain(sent.status)
    expect(assistantTextFrom(stored.events)).toEqual([
      'fake reply: initial seen',
      'fake reply: follow-up seen',
    ])
    const replies = await vi.waitFor(() => {
      const current = [...foldTeam(lead.id, lead.session.events).messages.values()]
        .filter(message => message.senderId === worker.id && message.targetId === lead.id)
      expect(current.map(message => message.content.at(0))).toContainEqual({ type: 'text', text: 'fake reply: follow-up seen' })
      return current
    }, { timeout: 5_000 })
    expect(replies.map(message => message.content.at(0))).toContainEqual({ type: 'text', text: 'fake reply: follow-up seen' })
    expect(records(cli.log).at(-1)?.prompt).toContain('follow-up question')
  })

  it('records external CLI failure as a teammate turn failure', async () => {
    const { ctx, lead } = await setup({ CLI_FAIL: '1' })

    const started = await spawnExternal(ctx, lead)
    const worker = await live(ctx, started.member.id)
    await worker.whenIdle()

    const turnEnd = worker.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' ? turnEnd.data.reason.kind : undefined).toBe('error')
    expect(assistantText(worker)).toEqual([])
  })

  it('terminates an in-flight CLI process during provider disposal', async () => {
    const { ctx, lead, cli, cliFiber } = await setup({ CLI_HANG: '1' })

    const started = await spawnExternal(ctx, lead)
    await live(ctx, started.member.id)
    await vi.waitFor(() => {
      expect(readFileSync(cli.log, 'utf8')).toContain('initial assignment')
    }, { timeout: 5_000 })

    await cliFiber.dispose()

    await vi.waitFor(() => {
      expect(readFileSync(cli.log, 'utf8')).toContain('"terminated":true')
    }, { timeout: 5_000 })
  })
})
