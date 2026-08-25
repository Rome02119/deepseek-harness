import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import TeamService from '@deepseek-ai/dsh-agent-team-gate'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import DshXCommandCenterService from '../src/index.ts'

async function waitForAgent(id: SessionId): Promise<Agent> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const agent = ctx.agents.get(id)
    if (agent !== undefined) return agent
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${id}`)
}

const ctx = new Context()
await ctx.plugin(WebServer, { host: '127.0.0.1', port: 3088 })
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(JsonlSessionPersistence, { root: mkdtempSync(join(tmpdir(), 'dsh-x-command-center-proof-')) })
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(SubagentService)
await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
await ctx.plugin(SubagentFork, { providerName: 'fork' })
await ctx.plugin(TeamService)
await ctx.plugin(DshXCommandCenterService)
ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang', 'hang']))
const agentTeams = ctx.get('agentTeams') as unknown as TeamService

const lead = ctx.agentLoop.create(SessionId('dsh-x-proof-lead'), { provider: 'mock', model: 'mock' })
const teammates = []
for (const name of ['proof-alpha', 'proof-beta'] as const) {
  teammates.push(await agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} teammate`,
    prompt: [{ type: 'text', text: 'stay available for command center proof' }],
    context: 'fresh',
    provider: 'spawn',
    signal: new AbortController().signal,
  }))
}
const verifier = await waitForAgent(teammates[0]!.member.id)
const task = await agentTeams.createTask(lead, {
  subject: 'proof task',
  description: 'real task created before HTTP action proof',
})
let blocked = await agentTeams.createTask(lead, {
  subject: 'blocked proof task',
  description: 'real blocked task for HTTP unblock proof',
})
for (let attempt = 1; attempt <= 5; attempt += 1) {
  const claimed = await agentTeams.updateTask(lead, {
    taskId: blocked.id,
    expectedRevision: blocked.revision,
    action: 'claim',
  })
  const reviewed = await agentTeams.updateTask(lead, {
    taskId: blocked.id,
    expectedRevision: claimed.revision,
    action: 'complete',
  })
  blocked = await agentTeams.updateTask(verifier, {
    taskId: blocked.id,
    expectedRevision: reviewed.revision,
    action: 'verify',
    errorSig: `proof-failure-${attempt}`,
    receipt: {
      verifierId: verifier.id,
      verifierName: 'proof-alpha',
      command: 'proof verification',
      exitCode: 1,
      gitSha: '0123456789abcdef',
      branch: 'proof',
      dirty: false,
      outputDigest: `sha256:proof-${attempt}`,
    },
  })
}

console.log(JSON.stringify({
  ready: true,
  port: ctx.webServer.port,
  teamId: String(lead.id),
  taskId: String(task.id),
  blockedTaskId: String(blocked.id),
}))
process.once('SIGTERM', () => { void ctx.fiber.dispose().then(() => process.exit(0)) })
