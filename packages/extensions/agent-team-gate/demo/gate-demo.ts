/** Keyless, self-checking walkthrough of the real Agent Teams verification gate. */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { foldTeam, TeamError, TeamId } from '../src/index.ts'
import type { TeamTaskReceipt, TeamTaskView } from '../src/index.ts'

const SIGNAL = new AbortController().signal
const ACTION_WIDTH = 48

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

function receipt(
  verifier: Agent,
  verifierName: string,
  overrides: Partial<TeamTaskReceipt> = {},
): TeamTaskReceipt {
  return {
    verifierId: verifier.id,
    verifierName,
    command: 'pnpm test',
    exitCode: 0,
    gitSha: '0123456789abcdef',
    branch: 'feature',
    dirty: false,
    outputDigest: 'sha256:verified',
    ...overrides,
  }
}

function line(step: number, action: string, outcome: string, detail: string): void {
  process.stdout.write(`STEP ${String(step).padStart(2)}  ${action.padEnd(ACTION_WIDTH)}  ${outcome.padEnd(7)}  ${detail}\n`)
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  for (let retry = 0; retry < 500; retry += 1) {
    const agent = ctx.agents.get(id)
    if (agent?.status === 'running') return agent
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`teammate "${id}" did not start`)
}

async function expectRefusal(
  step: number,
  action: string,
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  let caught: unknown
  try {
    await operation()
  } catch (error: unknown) {
    caught = error
  }
  assert(caught instanceof TeamError, `${action}: expected TeamError ${code}`)
  assert.equal(caught.code, code, `${action}: wrong refusal code`)
  line(step, action, 'REFUSED', caught.code)
}

function assertTask(
  task: TeamTaskView,
  expected: Partial<Pick<TeamTaskView, 'status' | 'ownerName' | 'attempts' | 'stagnation'>>,
): void {
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(task[field as keyof typeof expected], value, `${task.id}: unexpected ${field}`)
  }
}

async function setup(ctx: Context, storageRoot: string) {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, { leaseDurationMs: 1_000 })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(['hang', 'hang', 'hang']))
  const lead = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  const workerMember = await ctx.agentTeams.spawnTeammate(lead, {
    name: 'worker',
    description: 'implements the task',
    prompt: content('wait for work'),
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
  })
  const peerMember = await ctx.agentTeams.spawnTeammate(lead, {
    name: 'peer',
    description: 'shares worker provider',
    prompt: content('wait for work'),
    context: 'fresh',
    provider: 'spawn',
    signal: SIGNAL,
  })
  const inspectorMember = await ctx.agentTeams.spawnTeammate(lead, {
    name: 'inspector',
    description: 'verifies the work',
    prompt: content('wait to verify'),
    context: 'fork',
    provider: 'fork',
    signal: SIGNAL,
  })
  const worker = await waitRunning(ctx, workerMember.member.id)
  const peer = await waitRunning(ctx, peerMember.member.id)
  const inspector = await waitRunning(ctx, inspectorMember.member.id)
  return { lead, worker, peer, inspector }
}

async function runDemo(ctx: Context, storageRoot: string, setNow: (value: number) => void): Promise<void> {
  const { lead, worker, peer, inspector } = await setup(ctx, storageRoot)
  const providerReceipt = { workerProvider: 'spawn', verifierProvider: 'fork' }

  let task1 = await ctx.agentTeams.createTask(lead, {
    subject: 'add the login button',
    description: 'add the login button',
  })
  assert.equal(task1.id, 'task-1')
  assertTask(task1, { status: 'pending', attempts: 0 })
  line(1, 'lead creates task-1 "add the login button"', 'OK', 'task-1 -> pending')

  task1 = await ctx.agentTeams.updateTask(worker, {
    taskId: task1.id, expectedRevision: task1.revision, action: 'claim',
  })
  assertTask(task1, { status: 'in_progress', ownerName: 'worker' })
  line(2, 'worker claims it', 'OK', 'task-1 -> in_progress, owner worker')

  task1 = await ctx.agentTeams.updateTask(worker, {
    taskId: task1.id, expectedRevision: task1.revision, action: 'complete',
  })
  assertTask(task1, { status: 'in_review', ownerName: 'worker' })
  line(3, 'worker submits it (complete)', 'OK', 'task-1 -> in_review, owner worker')

  await expectRefusal(4, 'worker approves its own work', 'TEAM_SELF_GRADING', async () => {
    await ctx.agentTeams.updateTask(worker, {
      taskId: task1.id,
      expectedRevision: task1.revision,
      action: 'verify',
      receipt: receipt(worker, 'worker', providerReceipt),
    })
  })
  await expectRefusal(5, 'inspector approves, tree is dirty', 'TEAM_DIRTY_TREE', async () => {
    await ctx.agentTeams.updateTask(inspector, {
      taskId: task1.id,
      expectedRevision: task1.revision,
      action: 'verify',
      receipt: receipt(inspector, 'inspector', { ...providerReceipt, dirty: true }),
    })
  })
  await expectRefusal(6, 'peer uses worker provider', 'TEAM_SAME_PROVIDER', async () => {
    await ctx.agentTeams.updateTask(peer, {
      taskId: task1.id,
      expectedRevision: task1.revision,
      action: 'verify',
      receipt: receipt(peer, 'peer', { workerProvider: 'spawn', verifierProvider: 'fork' }),
    })
  })

  task1 = await ctx.agentTeams.updateTask(inspector, {
    taskId: task1.id,
    expectedRevision: task1.revision,
    action: 'verify',
    errorSig: 'tests-failed',
    receipt: receipt(inspector, 'inspector', { ...providerReceipt, exitCode: 1 }),
  })
  assertTask(task1, { status: 'pending', attempts: 1 })
  line(7, 'inspector approves, exit code is 1', 'FAIL', 'task-1 -> pending, attempts=1')

  task1 = await ctx.agentTeams.updateTask(worker, {
    taskId: task1.id, expectedRevision: task1.revision, action: 'claim',
  })
  task1 = await ctx.agentTeams.updateTask(worker, {
    taskId: task1.id, expectedRevision: task1.revision, action: 'complete',
  })
  assertTask(task1, { status: 'in_review', ownerName: 'worker', attempts: 1 })
  line(8, 'worker re-claims and re-submits', 'OK', 'task-1 -> in_review')

  const passingReceipt = receipt(inspector, 'inspector', providerReceipt)
  task1 = await ctx.agentTeams.updateTask(inspector, {
    taskId: task1.id,
    expectedRevision: task1.revision,
    action: 'verify',
    receipt: passingReceipt,
  })
  assertTask(task1, { status: 'completed', ownerName: 'worker', attempts: 1 })
  assert.deepEqual(task1.receipt, passingReceipt)
  line(9, 'inspector approves (exit 0, clean tree)', 'OK', 'task-1 -> completed; receipt(exit=0, clean, spawn->fork)')

  const completedSnapshot = foldTeam(lead.id, lead.session.events).tasks.get(task1.id)
  assert(completedSnapshot !== undefined, 'task-1 missing from durable log')
  const { receipt: _receipt, ...withoutReceipt } = completedSnapshot
  const forgedEvent: SessionEvent<'team/task'> = {
    type: 'team/task',
    seq: lead.session.events.length,
    time: Date.now(),
    data: {
      version: 1,
      teamId: TeamId(lead.id),
      task: { ...withoutReceipt, revision: completedSnapshot.revision + 1 },
    },
  }
  let replayError: unknown
  try {
    foldTeam(lead.id, [...lead.session.events, forgedEvent])
  } catch (error: unknown) {
    replayError = error
  }
  assert(replayError instanceof Error, 'forged completion was accepted during replay')
  assert.match(replayError.message, /completed without a receipt/u)
  line(10, 'forged completion without receipt', 'REFUSED', replayError.message)

  const firstFold = foldTeam(lead.id, lead.session.events)
  const secondFold = foldTeam(lead.id, lead.session.events)
  assert(isDeepStrictEqual(firstFold, secondFold), 'two folds produced different Team states')
  line(11, 'fold the same log twice', 'OK', 'identical (deterministic)')

  let task2 = await ctx.agentTeams.createTask(lead, { subject: 'lease demo', description: 'lease demo' })
  assert.equal(task2.id, 'task-2')
  task2 = await ctx.agentTeams.updateTask(worker, {
    taskId: task2.id, expectedRevision: task2.revision, action: 'claim',
  })
  assertTask(task2, { status: 'in_progress', ownerName: 'worker' })
  assert.equal(task2.leaseExpiresAt, 1_001_000)
  line(12, 'worker claims new task-2', 'OK', `owner worker, lease expires at ${String(task2.leaseExpiresAt)} ms`)

  setNow(1_001_001)
  task2 = await ctx.agentTeams.updateTask(inspector, {
    taskId: task2.id, expectedRevision: task2.revision, action: 'claim',
  })
  assertTask(task2, { status: 'in_progress', ownerName: 'inspector' })
  line(13, 'lease expires; inspector reclaims it', 'OK', 'task-2 -> in_progress, owner inspector')

  let task3 = await ctx.agentTeams.createTask(lead, { subject: 'attempt cap', description: 'attempt cap' })
  assert.equal(task3.id, 'task-3')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    task3 = await ctx.agentTeams.updateTask(worker, {
      taskId: task3.id, expectedRevision: task3.revision, action: 'claim',
    })
    task3 = await ctx.agentTeams.updateTask(worker, {
      taskId: task3.id, expectedRevision: task3.revision, action: 'complete',
    })
    task3 = await ctx.agentTeams.updateTask(inspector, {
      taskId: task3.id,
      expectedRevision: task3.revision,
      action: 'verify',
      errorSig: `failure-${String(attempt)}`,
      receipt: receipt(inspector, 'inspector', { ...providerReceipt, exitCode: 1 }),
    })
  }
  assertTask(task3, { status: 'blocked', attempts: 5, stagnation: 1 })
  line(14, 'five failed verifications on task-3', 'BLOCKED', 'task-3 -> blocked, attempts=5')

  await expectRefusal(15, 'inspector tries to unblock task-3', 'TEAM_LEAD_REQUIRED', async () => {
    await ctx.agentTeams.updateTask(inspector, {
      taskId: task3.id, expectedRevision: task3.revision, action: 'unblock',
    })
  })

  task3 = await ctx.agentTeams.updateTask(lead, {
    taskId: task3.id, expectedRevision: task3.revision, action: 'unblock',
  })
  assertTask(task3, { status: 'pending', attempts: 0, stagnation: 0 })
  assert.equal(task3.ownerName, undefined)
  line(16, 'lead unblocks task-3', 'OK', 'task-3 -> pending, attempts=0, stagnation=0')

  process.stdout.write('\n')
  process.stdout.write('PROVEN: A worker cannot approve work they contributed to.\n')
  process.stdout.write('PROVEN: Approval requires a clean tree, an independent provider, and a passing command.\n')
  process.stdout.write('PROVEN: Completed work needs a receipt, even when the log is replayed later.\n')
  process.stdout.write('PROVEN: Leases allow reassignment, and repeated failures stop endless retries.\n')
  process.stdout.write('PROVEN: Only the Lead can reset a blocked task.\n')
}

const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-gate-demo-'))
const ctx = new Context()
const realDateNow = Date.now
let now = 1_000_000
Date.now = () => now

try {
  await runDemo(ctx, storageRoot, (value) => { now = value })
} catch (error: unknown) {
  process.stderr.write(`DEMO FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  Date.now = realDateNow
  try {
    await ctx.fiber.dispose()
  } finally {
    rmSync(storageRoot, { recursive: true, force: true })
  }
}
