import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import TeamService from '@deepseek-ai/dsh-agent-team-gate'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import DshXCommandCenterService from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-x-command-center-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  await ctx.plugin(DshXCommandCenterService, { staleAfterMs: 1 })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang']))
  const lead = ctx.agentLoop.create(SessionId('center-lead'), { provider: 'mock', model: 'mock' })
  await ctx.agentTeams.spawnTeammate(lead, {
    name: 'worker-one',
    description: 'worker one',
    prompt: [{ type: 'text', text: 'stay available' }],
    context: 'fresh',
    provider: 'spawn',
    signal: new AbortController().signal,
  })
  return ctx
}

async function post(port: number, body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}/dsh-x-command-center/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() as Record<string, unknown> }
}

describe('dsh-x-command-center', () => {
  it('serves timestamped rows and routes actions through Agent Teams', async () => {
    const ctx = await setup()
    const port = ctx.webServer.port
    for (const path of ['/dsh-x-command-center', '/dsh-x-command-center.json', '/dsh-x-command-center/actions']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`, { headers: { origin: 'https://attacker.example' } })).status, path).toBe(401)
    }
    const page = await fetch(`http://127.0.0.1:${port}/dsh-x-command-center`).then(response => response.text())
    expect(page).toContain('Needs Rome')

    const before = await fetch(`http://127.0.0.1:${port}/dsh-x-command-center.json`).then(response => response.json()) as {
      teams: Array<{ id: string; timestamp: string }>
    }
    expect(before.teams[0]?.timestamp).toMatch(/T/)
    const teamId = before.teams[0]!.id

    const created = await post(port, {
      action: 'createTask',
      teamId,
      actor: 'lead',
      subject: 'wire command center',
      description: 'prove actions use real services',
    })
    expect(created.status).toBe(200)
    expect(created.json.ok).toBe(true)

    const claimed = await post(port, { action: 'claimTask', teamId, actor: 'lead', taskId: 'task-1' })
    expect(claimed.status).toBe(200)
    expect(claimed.json.ok).toBe(true)

    const refused = await post(port, { action: 'unblockTask', teamId, actor: 'worker-one', taskId: 'task-1' })
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe('TEAM_LEAD_REQUIRED')

    await ctx.fiber.dispose()
  })
})
