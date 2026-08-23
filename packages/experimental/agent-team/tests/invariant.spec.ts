import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantService, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as TeamInvariant from '../src/invariant.ts'
import { TeamId, TeamTaskId } from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService, { enabled: true })
  await ctx.plugin(TeamInvariant)
  return ctx
}

describe('Agent Teams stream invariant', () => {
  it('accepts provisioning and rejects a terminal member as the first edge', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('team-invariant'))
    const member = {
      id: SessionId('team-invariant-child'),
      name: 'worker',
      description: 'worker responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    expect(() => {
      session.append('team/member', { version: 1, teamId: TeamId(session.id), member })
    }).not.toThrow()

    const invalid = ctx.sessions.create(SessionId('team-invariant-invalid'))
    expect(() => {
      invalid.append('team/member', {
        version: 1,
        teamId: TeamId(invalid.id),
        member: { ...member, phase: 'active' },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-experimental-agent-team',
    }))
    expect(invalid.events).toEqual([])
  })

  it('rejects an invalid task dependency before publication', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('team-task-invariant'))

    expect(() => {
      session.append('team/task', {
        version: 1,
        teamId: TeamId(session.id),
        task: {
          id: TeamTaskId('task-1'),
          revision: 1,
          subject: 'invalid dependency',
          description: 'references a missing blocker',
          status: 'pending',
          attempts: 0,
          stagnation: 0,
          blockedBy: [TeamTaskId('missing')],
          writeScopes: [],
        },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-experimental-agent-team',
    }))
    expect(session.events).toEqual([])
  })

  it('accepts an in-review task with a verification receipt', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('team-task-review-invariant'))
    const receipt = {
      verifierId: SessionId('verifier'),
      verifierName: 'verifier',
      command: 'pnpm test',
      exitCode: 0,
      gitSha: '0123456789abcdef',
      branch: 'feature',
      dirty: false,
      outputDigest: 'sha256:verified',
    }

    expect(() => {
      const teamId = TeamId(session.id)
      const task = {
        id: TeamTaskId('task-1'),
        subject: 'review',
        description: 'awaiting verification',
        ownerId: SessionId('author'),
        attempts: 0,
        stagnation: 0,
        blockedBy: [],
        writeScopes: [],
      }
      session.append('team/task', { version: 1, teamId, task: { ...task, revision: 1, status: 'pending' } })
      session.append('team/task', { version: 1, teamId, task: { ...task, revision: 2, status: 'in_progress' } })
      session.append('team/task', {
        version: 1,
        teamId,
        task: { ...task, revision: 3, status: 'in_review', receipt },
      })
    }).not.toThrow()
    expect(session.events[2]?.data).toMatchObject({ task: { status: 'in_review', receipt } })
  })
})
