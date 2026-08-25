/** Real external CLI walkthrough for the Agent Team teammate bridge. */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TeamService, { foldTeam } from '@deepseek-ai/dsh-experimental-agent-team'
import * as ExternalCliTeam from '../src/index.ts'

const AGY = '/Users/rome/.local/bin/agy'
const CLAUDE = '/Users/rome/.local/bin/claude'
const CODEX = '/Users/rome/.local/bin/codex'
const SIGNAL = new AbortController().signal

const CLIS: Array<{
  readonly path: string
  readonly name: string
  readonly provider: string
  readonly llmProvider: string
  readonly cliKind: ExternalCliTeam.Config['cliKind']
  readonly reply: string
}> = [
  {
    path: AGY,
    name: 'agy-worker',
    provider: 'agy-team',
    llmProvider: 'agy-team-llm',
    cliKind: 'agy',
    reply: 'AGY_TEAM_REPLY',
  },
  {
    path: CLAUDE,
    name: 'claude-worker',
    provider: 'claude-team',
    llmProvider: 'claude-team-llm',
    cliKind: 'claude',
    reply: 'CLAUDE_TEAM_REPLY',
  },
  {
    path: CODEX,
    name: 'codex-worker',
    provider: 'codex-team',
    llmProvider: 'codex-team-llm',
    cliKind: 'codex',
    reply: 'CODEX_TEAM_REPLY',
  },
]

function content(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function assistantText(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event =>
    event.type === 'assistant/message'
      ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
}

function throwTurnError(events: readonly SessionEvent[], label: string): void {
  const turnEnd = events.findLast(event => event.type === 'turn/end')
  if (turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind === 'error') {
    throw new Error(`${label} failed: ${JSON.stringify(turnEnd.data.reason)}`)
  }
}

function userEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .flatMap(([name, value]) => value === undefined ? [] : [[name, value]]))
}

async function waitFor<T>(label: string, read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`${label} did not appear`)
}

async function main(): Promise<void> {
  for (const cli of CLIS) assert(existsSync(cli.path), `${cli.path} is not installed`)
  const root = mkdtempSync(join(tmpdir(), 'dsh-real-external-cli-team-'))
  const cwd = process.cwd()
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    await ctx.plugin(TeamService)
    for (const cli of CLIS) {
      await ctx.plugin(ExternalCliTeam, {
        providerName: cli.provider,
        llmProvider: cli.llmProvider,
        model: cli.cliKind,
        command: cli.path,
        cliKind: cli.cliKind,
        env: userEnv(),
      })
    }

    const lead = ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unused', model: 'unused' }, { cwd })
    for (const cli of CLIS) {
      const started = await ctx.agentTeams.spawnTeammate(lead, {
        name: cli.name,
        description: cli.name,
        prompt: content(`Reply exactly: ${cli.reply}_INITIAL`),
        context: 'fresh',
        provider: cli.provider,
        signal: SIGNAL,
      })
      await waitFor(`initial ${cli.name} assistant message`, async () => {
        const stored = await ctx.sessionPersistence.inspect(started.member.id)
        throwTurnError(stored.events, `initial ${cli.name} turn`)
        return assistantText(stored.events).some(text => text.trim() === `${cli.reply}_INITIAL`) ? stored : undefined
      })

      const sent = await ctx.agentTeams.sendMessage(lead, {
        target: cli.name,
        content: content(`Reply exactly: ${cli.reply}`),
        delivery: 'wakeup',
        signal: SIGNAL,
      })
      const stored = await waitFor(`follow-up ${cli.name} assistant message`, async () => {
        const candidate = await ctx.sessionPersistence.inspect(started.member.id)
        throwTurnError(candidate.events, `follow-up ${cli.name} turn`)
        return assistantText(candidate.events).some(text => text.trim() === cli.reply) ? candidate : undefined
      })
      const reply = await waitFor(`Team mailbox reply from ${cli.name}`, () => {
        const state = foldTeam(lead.id, lead.session.events)
        return [...state.messages.values()].find(message => message.senderId === started.member.id
          && message.targetId === lead.id
          && message.content.some(block => block.type === 'text' && block.text.includes(cli.reply)))
      })

      const state = foldTeam(lead.id, lead.session.events)
      console.log(`CLI ${cli.path}`)
      console.log(`MEMBER ${started.member.name} provider=${started.member.provider} id=${started.member.id}`)
      console.log(`INBOUND message=${sent.messageId} ${sent.status} delivered=${state.delivered.has(sent.messageId)}`)
      console.log(`ASSISTANT ${assistantText(stored.events).at(-1)}`)
      console.log(`TEAM_REPLY from=${reply.senderName} target=lead text=${reply.content.find(block => block.type === 'text')?.text}`)
    }
  } finally {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}

await main()
