import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import TeamService from '@deepseek-ai/dsh-agent-team-gate'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubscriptionQuotaService from '../../subscription-quota/src/index.ts'
import LiveAgentViewService from '../src/index.ts'

const ctx = new Context()
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 3086 })
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(JsonlSessionPersistence, { root: mkdtempSync(join(tmpdir(), 'rome-view-proof-')) })
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(SubagentService)
await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
await ctx.plugin(SubagentFork, { providerName: 'fork' })
await ctx.plugin(TeamService)
await ctx.plugin(SubscriptionQuotaService)
await ctx.plugin(LiveAgentViewService)
ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang', 'hang', 'hang']))
const lead = ctx.agentLoop.create(SessionId('proof-lead'), { provider: 'mock', model: 'mock' })
const team = ctx.agentTeams
for (const name of ['proof-worker-a', 'proof-worker-b']) {
  await team.spawnTeammate(lead, {
    name,
    description: `${name} live proof worker`,
    prompt: [{ type: 'text', text: 'stay running for the live view proof' }],
    context: 'fresh',
    provider: 'spawn',
    signal: new AbortController().signal,
  })
}
for (const [subject, owner] of [['quota investigation', 'proof-worker-a'], ['live view verification', 'proof-worker-b']] as const) {
  const task = await team.createTask(lead, { subject, description: `${subject} proof task` })
  await team.updateTask(lead, {
    taskId: task.id,
    expectedRevision: task.revision,
    action: 'reassign',
    owner,
  })
}
console.log(JSON.stringify({ ready: true, port: ctx.webServer.port, agents: ctx.agents.list().map(agent => String(agent.id)) }))
process.once('SIGTERM', () => { void ctx.fiber.dispose().then(() => process.exit(0)) })
