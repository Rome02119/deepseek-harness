import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import {
  applyTeamEvent,
  emptyTeamFoldState,
  foldTeam,
  isActiveTeamMember,
  isTaskAuthor,
  isTeamEvent,
} from '../src/fold.ts'
import type { TeamFoldState } from '../src/fold.ts'
import { TeamId, TeamMessageId, TeamTaskId } from '../src/types.ts'
import type {
  TeamMemberSnapshot,
  TeamMessageSnapshot,
  TeamTaskReceipt,
  TeamTaskSnapshot,
} from '../src/types.ts'

const ROOT = SessionId('team-root')
const TEAM = TeamId(ROOT)
const CHILD = SessionId('child-a')
const REVIEWER = SessionId('child-b')

function event<T extends SessionEventType>(type: T, data: SessionEventMap[T], seq: number): SessionEvent<T> {
  return { type, data, seq, time: seq } as SessionEvent<T>
}

/** Queued-minus-delivered mail, the recovery mailbox the fold is responsible for. */
function pending(state: TeamFoldState): TeamMessageSnapshot[] {
  return [...state.messages.values()].filter(message => !state.delivered.has(message.id))
}

/** Whether one fold reached the end of its log without applying any Team record. */
function isEmptyFold(state: TeamFoldState): boolean {
  return state.members.size === 0 && state.tasks.size === 0
    && state.messages.size === 0 && state.delivered.size === 0
}

function member(overrides: Partial<TeamMemberSnapshot> = {}): TeamMemberSnapshot {
  return {
    id: CHILD,
    name: 'worker-a',
    description: 'worker',
    provider: 'spawn',
    context: 'fresh',
    phase: 'provisioning',
    ...overrides,
  }
}

function memberHistory(phase: TeamMemberSnapshot['phase']): SessionEvent[] {
  const records: SessionEvent[] = [
    event('team/member', { version: 1, teamId: TEAM, member: member() }, 0),
  ]
  if (phase !== 'provisioning') {
    records.push(event('team/member', { version: 1, teamId: TEAM, member: member({ phase }) }, 1))
  }
  return records
}

function task(overrides: Partial<TeamTaskSnapshot> = {}): TeamTaskSnapshot {
  const result: TeamTaskSnapshot = {
    id: TeamTaskId('task-1'),
    revision: 1,
    subject: 'subject',
    description: 'description',
    status: 'pending',
    authorIds: [],
    attempts: 0,
    stagnation: 0,
    blockedBy: [],
    writeScopes: [],
    ...overrides,
  }
  return result.ownerId !== undefined && overrides.authorIds === undefined
    ? { ...result, authorIds: [result.ownerId] }
    : result
}

function receipt(overrides: Partial<TeamTaskReceipt> = {}): TeamTaskReceipt {
  return {
    verifierId: CHILD,
    verifierName: 'worker-a',
    command: 'pnpm test',
    exitCode: 0,
    gitSha: '0123456789abcdef',
    branch: 'feature',
    dirty: false,
    outputDigest: 'sha256:verified',
    workerProvider: 'spawn',
    verifierProvider: 'detached',
    ...overrides,
  }
}

function taskReviewHistory(startSeq = 0, ownerId = ROOT): SessionEvent[] {
  return [
    event('team/task', { version: 1, teamId: TEAM, task: task() }, startSeq),
    event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 2, status: 'in_progress', ownerId, authorIds: [ownerId] }),
    }, startSeq + 1),
    event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 3, status: 'in_review', ownerId, authorIds: [ownerId] }),
    }, startSeq + 2),
  ]
}

function message(overrides: Partial<TeamMessageSnapshot> = {}): TeamMessageSnapshot {
  return {
    id: TeamMessageId('message-1'),
    senderId: ROOT,
    senderName: 'lead',
    targetId: CHILD,
    delivery: 'quiet',
    content: [{ type: 'text', text: 'hello' }],
    ...overrides,
  }
}

describe('Agent Teams fold', () => {
  it('folds current-team records and ignores inherited records', () => {
    const records: SessionEvent[] = [
      event('team/member', { version: 1, teamId: TeamId('ancestor'), member: member() }, 0),
      event('team/member', { version: 1, teamId: TEAM, member: member() }, 1),
      event('team/member', {
        version: 1,
        teamId: TEAM,
        member: member({ phase: 'active' }),
      }, 2),
      event('team/task', { version: 1, teamId: TEAM, task: task({ id: TeamTaskId('task-7') }) }, 3),
      event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 4),
    ]
    const state = foldTeam(ROOT, records)

    expect(state).toMatchObject({ id: TEAM })
    expect(state.members.size).toBe(1)
    expect(state.tasks.size).toBe(1)
    expect(pending(state)).toHaveLength(1)
    expect(state.nextTaskNumber).toBe(8)
    expect(state.members.get(CHILD)?.name).toBe('worker-a')
    expect(isTeamEvent(records[0]!)).toBe(true)
    expect(isTeamEvent(event('turn/start', { turn: 1 }, 5))).toBe(false)
  })

  it('enforces teammate identity and lifecycle', () => {
    const base = event('team/member', { version: 1, teamId: TEAM, member: member() }, 0)
    expect(() => foldTeam(ROOT, [event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, 0)])).toThrow(/must begin provisioning/)
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ name: 'renamed', phase: 'active' }),
    }, 1)])).toThrow(/immutable identity/)
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, 1), event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'failed' }),
    }, 2)])).toThrow(/invalid active -> failed/)

    const duplicateName = member({ id: SessionId('child-b') })
    expect(() => foldTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: duplicateName,
    }, 1)])).toThrow(/name .* reused/)
  })

  it('enforces task revision continuity', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, 0)
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 2 }),
    }, 0)])).toThrow(/begin at revision 1/)
    expect(() => foldTeam(ROOT, [first, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 3 }),
    }, 1)])).toThrow(/revision is not contiguous/)
  })

  it('accepts an in-review task with a verification receipt', () => {
    const verification = receipt()
    const records = taskReviewHistory()
    records[2] = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 3, status: 'in_review', ownerId: ROOT, receipt: verification }),
    }, 2)
    const state = foldTeam(ROOT, records)
    expect(state.tasks.get(TeamTaskId('task-1'))).toMatchObject({ status: 'in_review', receipt: verification })
  })

  it('rejects a forged completed task without a receipt', () => {
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ status: 'completed' }),
    }, 0)])).toThrow(/invalid new -> completed transition/)

    expect(() => foldTeam(ROOT, [...taskReviewHistory(), event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'completed', ownerId: ROOT }),
    }, 3)])).toThrow(/completed without a receipt/)
  })

  it.each([
    ['a non-zero exit code', receipt({ exitCode: 1 }), /failing receipt/],
    ['a dirty tree', receipt({ dirty: true }), /dirty receipt/],
    ['a task author as verifier', receipt({ verifierId: ROOT }), /verified by one of its authors/],
    ['the worker provider as verifier', receipt({ verifierProvider: 'spawn' }), /worker provider/],
  ])('rejects a completed task receipt with %s', (_case, verification, expected) => {
    expect(() => foldTeam(ROOT, [...taskReviewHistory(), event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'completed', ownerId: ROOT, receipt: verification }),
    }, 3)])).toThrow(expected)
  })

  it('rejects a completed task verified by an id outside the Team roster', () => {
    const verifierId = SessionId('nobody')
    expect(() => foldTeam(ROOT, [...taskReviewHistory(), event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'completed', ownerId: ROOT, receipt: receipt({ verifierId }) }),
    }, 3)])).toThrow(`team task "task-1" was verified by inactive or unknown member "${verifierId}"`)
  })

  it.each(['provisioning', 'failed'] as const)(
    'rejects a completed task verified by a %s roster member',
    (phase) => {
      const roster = memberHistory(phase)
      expect(() => foldTeam(ROOT, [...roster, ...taskReviewHistory(roster.length), event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 4, status: 'completed', ownerId: ROOT, receipt: receipt() }),
      }, roster.length + 3)])).toThrow(`inactive or unknown member "${CHILD}"`)
    },
  )

  it('accepts the Team Lead as verifier without a roster row', () => {
    const state = foldTeam(ROOT, [...memberHistory('active'), ...taskReviewHistory(2, CHILD), event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'completed', ownerId: CHILD, receipt: receipt({ verifierId: ROOT }) }),
    }, 5)])
    expect(state.tasks.get(TeamTaskId('task-1'))?.status).toBe('completed')
  })

  it('rejects an illegal pending -> completed task transition', () => {
    expect(() => foldTeam(ROOT, [
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'completed', ownerId: ROOT, receipt: receipt() }),
      }, 1),
    ])).toThrow(/invalid pending -> completed transition/)
  })

  it('replays a verification accepted by the API authorship and membership rules', () => {
    const verification = receipt()
    const records = [...memberHistory('active'), ...taskReviewHistory(2)]
    const state = foldTeam(ROOT, records)
    const reviewed = state.tasks.get(TeamTaskId('task-1'))!
    expect(isActiveTeamMember(state, verification.verifierId)).toBe(true)
    expect(isTaskAuthor(reviewed, verification.verifierId)).toBe(false)
    expect(() => { applyTeamEvent(state, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'completed', ownerId: ROOT, receipt: verification }),
    }, 5)) }).not.toThrow()
    expect(state.tasks.get(TeamTaskId('task-1'))).toMatchObject({ status: 'completed', receipt: verification })
  })

  it('replays verification by an assignee who never acted on the task', () => {
    const verification = receipt()
    const records = [
      ...memberHistory('active'),
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 2),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: CHILD, authorIds: [] }),
      }, 3),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 3, status: 'in_progress', ownerId: ROOT, authorIds: [] }),
      }, 4),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 4, status: 'in_review', ownerId: ROOT, authorIds: [ROOT] }),
      }, 5),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 5, status: 'completed', ownerId: ROOT, authorIds: [ROOT], receipt: verification }),
      }, 6),
    ]

    expect(() => foldTeam(ROOT, records)).not.toThrow()
  })

  it('enforces verification blocking through the shared failure-cap predicate', () => {
    const failing = receipt({ exitCode: 1 })
    const review = taskReviewHistory()
    expect(() => foldTeam(ROOT, [...review, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'blocked', authorIds: [ROOT], attempts: 2, stagnation: 2, receipt: failing }),
    }, 3)])).toThrow(/blocked below the verification failure cap/)
    expect(() => foldTeam(ROOT, [...review, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'pending', authorIds: [ROOT], attempts: 5, stagnation: 1, receipt: failing }),
    }, 3)])).toThrow(/remained pending at the verification failure cap/)

    const blocked = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 4, status: 'blocked', authorIds: [ROOT], attempts: 3, stagnation: 3, receipt: failing }),
    }, 3)
    const unblocked = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 5, status: 'pending', authorIds: [ROOT], receipt: failing }),
    }, 4)
    expect(() => foldTeam(ROOT, [...review, blocked, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 5, status: 'pending', authorIds: [ROOT], attempts: 3, stagnation: 3, receipt: failing }),
    }, 4)])).toThrow(/unblocked without resetting attempts/)
    expect(foldTeam(ROOT, [...review, blocked, unblocked]).tasks.get(TeamTaskId('task-1')))
      .toMatchObject({ status: 'pending', attempts: 0, stagnation: 0 })
  })

  it.each([
    ['drops', [CHILD]],
    ['reorders', [CHILD, ROOT]],
  ] as const)('rejects a task event that %s prior authorIds', (_case, authorIds) => {
    const records = [
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
      }, 1),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 3, status: 'in_progress', ownerId: CHILD, authorIds: [ROOT, CHILD] }),
      }, 2),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 4, status: 'in_progress', ownerId: CHILD, authorIds: [...authorIds] }),
      }, 3),
    ]
    expect(() => foldTeam(ROOT, records)).toThrow(/changed prior authorIds/)
  })

  it('rejects a task event that appends an author other than the prior or next owner', () => {
    const records = [
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
      }, 1),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 3, status: 'in_progress', ownerId: CHILD, authorIds: [ROOT, REVIEWER] }),
      }, 2),
    ]

    expect(() => foldTeam(ROOT, records))
      .toThrow(`team task "task-1" appended authorId "${REVIEWER}" without prior or next ownership`)
  })

  it('rejects a task event that appends two authors', () => {
    const records = [
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT, CHILD] }),
      }, 1),
    ]

    expect(() => foldTeam(ROOT, records))
      .toThrow(`team task "task-1" appended more than one authorId; offending id "${CHILD}"`)
  })

  it.each([
    ['claim append', [
      task(),
      task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
    ]],
    ['owner-mutation append', [
      task(),
      task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [] }),
      task({ revision: 3, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
    ]],
    ['release append', [
      task(),
      task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [] }),
      task({ revision: 3, status: 'pending', authorIds: [ROOT] }),
    ]],
    ['reassign without append', [
      task(),
      task({ revision: 2, status: 'in_progress', ownerId: CHILD, authorIds: [] }),
    ]],
  ] as const)('folds a legitimate %s', (_case, snapshots) => {
    const records = snapshots.map((snapshot, index) => event('team/task', {
      version: 1,
      teamId: TEAM,
      task: snapshot,
    }, index))

    expect(() => foldTeam(ROOT, records)).not.toThrow()
  })

  it('replays an API-accepted claim, renew, release, reclaim, complete, and verify sequence', () => {
    const records = [
      event('team/member', {
        version: 1,
        teamId: TEAM,
        member: member({ id: REVIEWER, name: 'reviewer' }),
      }, 0),
      event('team/member', {
        version: 1,
        teamId: TEAM,
        member: member({ id: REVIEWER, name: 'reviewer', phase: 'active' }),
      }, 1),
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 2),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
      }, 3),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 3, status: 'in_progress', ownerId: ROOT, authorIds: [ROOT] }),
      }, 4),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 4, status: 'pending', authorIds: [ROOT] }),
      }, 5),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 5, status: 'in_progress', ownerId: CHILD, authorIds: [ROOT, CHILD] }),
      }, 6),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 6, status: 'in_review', ownerId: CHILD, authorIds: [ROOT, CHILD] }),
      }, 7),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({
          revision: 7,
          status: 'completed',
          ownerId: CHILD,
          authorIds: [ROOT, CHILD],
          receipt: receipt({ verifierId: REVIEWER, verifierName: 'reviewer' }),
        }),
      }, 8),
    ]

    expect(() => foldTeam(ROOT, records)).not.toThrow()
  })

  it.each([
    ['attempts', { attempts: 2, stagnation: 0 }, { attempts: 1, stagnation: 0 }],
    ['stagnation', { attempts: 2, stagnation: 2 }, { attempts: 2, stagnation: 1 }],
  ] as const)('rejects a task event that lowers %s', (field, prior, next) => {
    expect(() => foldTeam(ROOT, [
      event('team/task', { version: 1, teamId: TEAM, task: task(prior) }, 0),
      event('team/task', { version: 1, teamId: TEAM, task: task({ revision: 2, ...next }) }, 1),
    ])).toThrow(`team task "task-1" lowered ${field}`)
  })

  it('folds past lease timestamps deterministically without consulting the clock', () => {
    const records = [
      event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
      event('team/task', {
        version: 1,
        teamId: TEAM,
        task: task({ revision: 2, status: 'in_progress', ownerId: ROOT, leaseExpiresAt: 1 }),
      }, 1),
    ]
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('fold consulted clock') })
    const first = foldTeam(ROOT, records)
    const second = foldTeam(ROOT, records)
    expect([...first.tasks]).toEqual([...second.tasks])
    expect(first.tasks.get(TeamTaskId('task-1'))?.leaseExpiresAt).toBe(1)
    clock.mockRestore()
  })

  it.each([
    ['attempts', -1],
    ['attempts', 1.5],
    ['stagnation', -1],
    ['stagnation', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects invalid persisted task %s', (field, value) => {
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ [field]: value }),
    }, 0)])).toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })

  it('rejects duplicate persisted task author ids', () => {
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ authorIds: [ROOT, ROOT] }),
    }, 0)])).toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })

  it('rejects every invalid persisted task dependency relation', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, 0)
    const second = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({
        id: TeamTaskId('task-2'),
        blockedBy: [TeamTaskId('task-1')],
      }),
    }, 1)
    const invalid: Array<{ records: SessionEvent[]; message: RegExp }> = [
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('missing')] }),
        }, 0)],
        message: /blocker task "missing" .* is missing or deleted/,
      },
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('task-1')] }),
        }, 0)],
        message: /cannot block itself/,
      },
      {
        records: [first, event('team/task', {
          ...second.data,
          task: { ...second.data.task, blockedBy: [TeamTaskId('task-1'), TeamTaskId('task-1')] },
        }, 1)],
        message: /repeats blocker/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, blockedBy: [TeamTaskId('task-2')] }),
        }, 2)],
        message: /dependency cycle/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, status: 'deleted' }),
        }, 2)],
        message: /blocker task "task-1" .* is missing or deleted/,
      },
    ]

    for (const { records, message: expected } of invalid) {
      expect(() => foldTeam(ROOT, records)).toThrow(expected)
    }
  })

  it('leaves numeric allocation unchanged for a branded nonstandard task id', () => {
    const state = foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('external-task') }),
    }, 0)])
    expect(state.nextTaskNumber).toBe(1)
  })

  it('rejects a persisted numeric task id outside the safe integer range', () => {
    expect(() => foldTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('task-9007199254740992') }),
    }, 0)])).toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })

  it('enforces mailbox queue and acknowledgement relations', () => {
    const queued = event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 0)
    const delivered = event('team/message/delivered', {
      version: 1,
      teamId: TEAM,
      messageId: TeamMessageId('message-1'),
      targetId: CHILD,
    }, 1)
    expect(pending(foldTeam(ROOT, [queued, delivered]))).toEqual([])
    expect(() => foldTeam(ROOT, [queued, queued])).toThrow(/queued twice/)
    expect(() => foldTeam(ROOT, [delivered])).toThrow(/delivered before queueing/)
    expect(() => foldTeam(ROOT, [queued, event('team/message/delivered', {
      ...delivered.data,
      targetId: SessionId('other'),
    }, 1)])).toThrow(/target changed/)
    expect(() => foldTeam(ROOT, [queued, delivered, { ...delivered, seq: 2 }])).toThrow(/delivered twice/)
  })

  it('validates every current-version persisted payload before folding it', () => {
    const malformed = [
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, 0),
        data: { version: 1, teamId: TEAM, member: { ...member(), name: 42 } },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
        data: { version: 1, teamId: TEAM, task: { ...task(), blockedBy: [42] } },
      },
      {
        ...event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, 0),
        data: {
          version: 1,
          teamId: TEAM,
          message: { ...message(), content: [{ type: 'text', text: 42 }] },
        },
      },
      {
        ...event('team/message/delivered', {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: CHILD,
        }, 0),
        data: {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: 42,
        },
      },
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, 0),
        data: { version: 1, teamId: TEAM, member: member(), unexpected: true },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, 0),
        data: { version: 1, teamId: 42, task: task() },
      },
    ] as unknown as SessionEvent[]

    for (const candidate of malformed) {
      expect(() => foldTeam(ROOT, [candidate]))
        .toThrow(/persisted Agent Teams .* payload is invalid/)
    }
  })

  it('retains merge-extensible content blocks while rejecting malformed core variants', () => {
    const extension = { type: 'plugin/custom', payload: { value: 1 } } as never
    const state = foldTeam(ROOT, [event('team/message/queued', {
      version: 1,
      teamId: TEAM,
      message: message({ content: [extension] }),
    }, 0)])
    expect(pending(state)[0]?.content).toEqual([extension])
  })

  it('rejects unsupported event versions without mutating an empty state', () => {
    const state = emptyTeamFoldState(ROOT)
    const invalid = event('team/task', {
      version: 2 as 1,
      teamId: TEAM,
      task: task(),
    }, 0)
    expect(() => { applyTeamEvent(state, invalid) }).toThrow(/unsupported Agent Teams event version 2/)
    expect(isEmptyFold(state)).toBe(true)
  })

  it('ignores unsupported inherited Team records before decoding their version', () => {
    const inherited = event('team/task', {
      version: 2 as 1,
      teamId: TeamId('ancestor'),
      task: task(),
    }, 0)
    expect(isEmptyFold(foldTeam(ROOT, [inherited]))).toBe(true)
  })

  it('still validates complete current-version records inherited from another Team', () => {
    const inherited = {
      ...event('team/task', {
        version: 1,
        teamId: TeamId('ancestor'),
        task: task(),
      }, 0),
      data: {
        version: 1,
        teamId: TeamId('ancestor'),
        task: { ...task(), subject: 42 },
      },
    } as unknown as SessionEvent
    expect(() => foldTeam(ROOT, [inherited]))
      .toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })
})
