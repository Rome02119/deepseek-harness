/** Real agy CLI walkthrough for the Agent Team external teammate bridge. */

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
const SIGNAL = new AbortController().signal

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
  assert(existsSync(AGY), `${AGY} is not installed`)
  const root = mkdtempSync(join(tmpdir(), 'dsh-real-agy-team-'))
  const cwd = process.cwd()
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    await ctx.plugin(TeamService)
    await ctx.plugin(ExternalCliTeam, {
      providerName: 'agy-team',
      command: AGY,
      cliKind: 'agy',
      env: userEnv(),
    })

    const lead = ctx.agentLoop.create(SessionId(randomUUID()), { provider: 'unused', model: 'unused' }, { cwd })
    const started = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'agy-worker',
      description: 'agy worker',
      prompt: content('Reply exactly: EXTERNAL_CLI_INITIAL'),
      context: 'fresh',
      provider: 'agy-team',
      signal: SIGNAL,
    })
    await waitFor('initial agy assistant message', async () => {
      const stored = await ctx.sessionPersistence.inspect(started.member.id)
      throwTurnError(stored.events, 'initial agy turn')
      return assistantText(stored.events).some(text => text.includes('EXTERNAL_CLI_INITIAL')) ? stored : undefined
    })

    const sent = await ctx.agentTeams.sendMessage(lead, {
      target: 'agy-worker',
      content: content('Reply exactly: EXTERNAL_CLI_REPLY'),
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    const stored = await waitFor('follow-up agy assistant message', async () => {
      const candidate = await ctx.sessionPersistence.inspect(started.member.id)
      throwTurnError(candidate.events, 'follow-up agy turn')
      return assistantText(candidate.events).some(text => text.includes('EXTERNAL_CLI_REPLY')) ? candidate : undefined
    })
    const reply = await waitFor('Team mailbox reply from agy worker', () => {
      const state = foldTeam(lead.id, lead.session.events)
      return [...state.messages.values()].find(message => message.senderId === started.member.id
        && message.targetId === lead.id
        && message.content.some(block => block.type === 'text' && block.text.includes('EXTERNAL_CLI_REPLY')))
    })

    const state = foldTeam(lead.id, lead.session.events)
    console.log(`CLI ${AGY}`)
    console.log(`MEMBER ${started.member.name} provider=${started.member.provider} id=${started.member.id}`)
    console.log(`INBOUND message=${sent.messageId} status=${sent.status} delivered=${state.delivered.has(sent.messageId)}`)
    console.log(`ASSISTANT ${assistantText(stored.events).at(-1)}`)
    console.log(`TEAM_REPLY from=${reply.senderName} target=lead text=${reply.content.find(block => block.type === 'text')?.text}`)
    console.log(`TEAM_EVENTS ${lead.session.events.filter(event => event.type.startsWith('team/')).map(event => event.type).join(',')}`)
  } finally {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}

await main()
