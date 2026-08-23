/** Shared Team task DAG commands and runtime-enriched views. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamMembership } from './roster.ts'
import { TeamError } from './error.ts'
import {
  assertTaskCounterTransition,
  isActiveTeamMember,
  isTaskAuthor,
  isTaskVerificationBlocked,
  type TeamFoldState,
} from './fold.ts'
import type { TeamJournal } from './journal.ts'
import { resolveActiveMember } from './roster.ts'
import { assertTaskGraphCandidate, TeamTaskGraphError } from './task-graph.ts'
import type { TeamTaskGraphViolation } from './task-graph.ts'
import { TeamId, TeamTaskId } from './types.ts'
import type {
  CreateTeamTaskRequest,
  TeamTaskSnapshot,
  TeamTaskView,
  UpdateTeamTaskRequest,
} from './types.ts'
import { requiredText, writeScope } from './validation.ts'

/** Whether two normalized file or directory prefixes overlap on path components. */
function scopesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

const TASK_GRAPH_ERROR_CODES: Record<TeamTaskGraphViolation, string> = {
  missing: 'TEAM_TASK_NOT_FOUND',
  duplicate: 'TEAM_INVALID_ARGUMENT',
  cycle: 'TEAM_TASK_DEPENDENCY_CYCLE',
}

/** Owns Team task limits, authorization, transitions, and derived views. */
export class TeamTaskBoard {
  /**
   * @param journal - authoritative Lead-log transaction owner.
   * @param maxTasks - maximum non-deleted tasks retained by one Team.
   * @param leaseDurationMs - milliseconds assigned to each claim or renewal.
   */
  constructor(
    private readonly journal: TeamJournal,
    private readonly maxTasks: number,
    private readonly leaseDurationMs: number,
  ) {}

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param membership - exact caller membership resolved by the Team roster.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async create(membership: TeamMembership, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    const { root } = membership
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const active = [...state.tasks.values()].filter(task => task.status !== 'deleted').length
      if (active >= this.maxTasks) {
        throw new TeamError(`Team task limit ${this.maxTasks} reached`, 'TEAM_TASK_LIMIT')
      }
      const id = TeamTaskId(`task-${state.nextTaskNumber}`)
      if (state.tasks.has(id)) {
        throw new TeamError('Team task id space exhausted', 'TEAM_TASK_LIMIT')
      }
      const task: TeamTaskSnapshot = {
        id,
        revision: 1,
        subject: requiredText(request.subject, 'subject', 200),
        description: requiredText(request.description, 'description', 16_384),
        status: 'pending',
        authorIds: [],
        attempts: 0,
        stagnation: 0,
        blockedBy: this.dependencies(request.blockedBy ?? [], state),
        writeScopes: this.writeScopes(request.writeScopes ?? []),
      }
      this.assertTaskGraph(state, task)
      await this.journal.appendAndFlush(root, 'team/task', { version: 1, teamId: TeamId(root.id), task })
      return this.taskView(root, state, task, Date.now())
    })
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param membership - exact caller membership resolved by the Team roster.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  get(membership: TeamMembership, id: TeamTaskId): TeamTaskView {
    const { root } = membership
    const state = this.journal.state(root)
    const task = state.tasks.get(id)
    if (task === undefined) throw new TeamError(`team task "${id}" not found`, 'TEAM_TASK_NOT_FOUND')
    return this.taskView(root, state, task, Date.now())
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param membership - exact caller membership resolved by the Team roster.
   * @returns detached current task views.
   */
  list(membership: TeamMembership): TeamTaskView[] {
    const { root } = membership
    const state = this.journal.state(root)
    const now = Date.now()
    return [...state.tasks.values()]
      .filter(task => task.status !== 'deleted')
      .map(task => this.taskView(root, state, task, now))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param membership - caller role and exact live Lead.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async update(
    caller: Agent,
    membership: TeamMembership,
    request: UpdateTeamTaskRequest,
  ): Promise<TeamTaskView> {
    const root = membership.root
    return this.journal.transact(root.id, async () => {
      const now = Date.now()
      const state = this.journal.state(root)
      const current = state.tasks.get(request.taskId)
      if (current === undefined) throw new TeamError(`team task "${request.taskId}" not found`, 'TEAM_TASK_NOT_FOUND')
      if (current.revision !== request.expectedRevision) {
        throw new TeamError(
          `stale team task "${current.id}" revision ${request.expectedRevision}; current revision is ${current.revision}`,
          'TEAM_TASK_STALE_REVISION',
        )
      }
      if (current.status === 'deleted') throw new TeamError(`team task "${current.id}" is deleted`, 'TEAM_TASK_DELETED')
      const lead = membership.role === 'lead'
      const owner = current.ownerId === caller.id
      const authorizeOwner = (): void => {
        if (!lead && !owner) throw new TeamError('task mutation requires its owner or Team Lead', 'TEAM_TASK_UNAUTHORIZED')
      }
      let next: TeamTaskSnapshot
      const leaseExpiresAt = Math.min(Number.MAX_SAFE_INTEGER, now + this.leaseDurationMs)
      switch (request.action) {
        case 'claim': {
          const reclaim = current.status === 'in_progress'
            && current.leaseExpiresAt !== undefined
            && now > current.leaseExpiresAt
          if (!reclaim && current.ownerId !== undefined && current.ownerId !== caller.id) {
            throw new TeamError(`team task "${current.id}" is owned by another member`, 'TEAM_TASK_ALREADY_CLAIMED')
          }
          if (!reclaim && (current.status !== 'pending' || !this.taskReady(state, current))) {
            throw new TeamError(`team task "${current.id}" is not ready to claim`, 'TEAM_TASK_BLOCKED')
          }
          next = this.withOwner(current, caller.id, { leaseExpiresAt })
          break
        }
        case 'renew':
          if (current.status !== 'in_progress') {
            throw new TeamError('only an in-progress task lease can be renewed', 'TEAM_TASK_INVALID_TRANSITION')
          }
          if (!owner) throw new TeamError('task lease renewal requires its owner', 'TEAM_TASK_NOT_OWNER')
          next = { ...current, leaseExpiresAt }
          break
        case 'release':
          authorizeOwner()
          if (current.status !== 'in_progress') throw new TeamError('only an in-progress task can be released', 'TEAM_TASK_INVALID_TRANSITION')
          next = this.withoutOwner({ ...current, status: 'pending' })
          break
        case 'edit':
          authorizeOwner()
          if (request.subject === undefined && request.description === undefined && request.writeScopes === undefined) {
            throw new TeamError('task edit requires subject, description, or write_scopes', 'TEAM_INVALID_ARGUMENT')
          }
          next = {
            ...current,
            ...request.subject === undefined ? {} : { subject: requiredText(request.subject, 'subject', 200) },
            ...request.description === undefined
              ? {}
              : { description: requiredText(request.description, 'description', 16_384) },
            ...request.writeScopes === undefined ? {} : { writeScopes: this.writeScopes(request.writeScopes) },
          }
          break
        case 'set_dependencies':
          authorizeOwner()
          if (request.blockedBy === undefined) throw new TeamError('set_dependencies requires blocked_by', 'TEAM_INVALID_ARGUMENT')
          next = { ...current, blockedBy: this.dependencies(request.blockedBy, state, current.id) }
          break
        case 'complete':
          authorizeOwner()
          if (current.status !== 'in_progress') throw new TeamError('only an in-progress task can complete', 'TEAM_TASK_INVALID_TRANSITION')
          next = this.withoutLease({ ...current, status: 'in_review' })
          break
        case 'verify': {
          if (!isActiveTeamMember(state, caller.id)) {
            throw new TeamError(`Team member "${caller.id}" is not active`, 'TEAM_MEMBER_NOT_ACTIVE')
          }
          if (request.receipt === undefined) throw new TeamError('verify requires a receipt', 'TEAM_INVALID_ARGUMENT')
          if (current.status !== 'in_review') throw new TeamError('only an in-review task can be verified', 'TEAM_TASK_INVALID_TRANSITION')
          if (isTaskAuthor(current, caller.id)) {
            throw new TeamError('a task cannot be verified by its own author', 'TEAM_SELF_GRADING')
          }
          const receipt = {
            ...request.receipt,
            verifierId: caller.id,
            verifierName: resolveActiveMember(root, state, membership.name).name,
          }
          if (receipt.dirty) throw new TeamError('verification requires a clean tree', 'TEAM_DIRTY_TREE')
          if (receipt.workerProvider !== undefined && receipt.workerProvider === receipt.verifierProvider) {
            throw new TeamError('verifier must be a different provider than the worker', 'TEAM_SAME_PROVIDER')
          }
          if (receipt.exitCode === 0) {
            next = { ...current, status: 'completed', receipt }
          } else {
            const attempts = current.attempts + 1
            const stagnation = request.errorSig === current.lastErrorSig ? current.stagnation + 1 : 1
            const { lastErrorSig: _lastErrorSig, ...withoutLastErrorSig } = current
            const failed: TeamTaskSnapshot = {
              ...withoutLastErrorSig,
              status: 'pending',
              receipt,
              attempts,
              stagnation,
              ...request.errorSig === undefined ? {} : { lastErrorSig: request.errorSig },
            }
            next = this.withoutOwner({
              ...failed,
              status: isTaskVerificationBlocked(failed) ? 'blocked' : 'pending',
            })
          }
          break
        }
        case 'reopen':
          authorizeOwner()
          if (current.status !== 'completed' && current.status !== 'in_review') {
            throw new TeamError('only a completed or in-review task can reopen', 'TEAM_TASK_INVALID_TRANSITION')
          }
          next = this.withoutOwner({ ...current, status: 'pending' })
          break
        case 'reassign': {
          if (!lead) throw new TeamError('only the Team Lead can reassign tasks', 'TEAM_LEAD_REQUIRED')
          if (current.status !== 'pending' && current.status !== 'in_progress') {
            throw new TeamError(
              'only a pending or in-progress task can be reassigned',
              'TEAM_TASK_INVALID_TRANSITION',
            )
          }
          if (request.owner === undefined || request.owner.trim().length === 0) {
            next = this.withoutOwner({ ...current, status: 'pending' })
            break
          }
          if (!this.taskReady(state, current)) throw new TeamError(`team task "${current.id}" is blocked`, 'TEAM_TASK_BLOCKED')
          const assignee = resolveActiveMember(root, state, request.owner)
          next = this.withOwner(current, assignee.id)
          break
        }
        case 'unblock':
          if (!lead) throw new TeamError('only the Team Lead can unblock tasks', 'TEAM_LEAD_REQUIRED')
          if (current.status !== 'blocked') {
            throw new TeamError('only a blocked task can be unblocked', 'TEAM_TASK_INVALID_TRANSITION')
          }
          next = this.withoutOwner({ ...current, status: 'pending', attempts: 0, stagnation: 0 })
          break
        case 'delete': {
          authorizeOwner()
          const dependent = [...state.tasks.values()].find(task =>
            task.status !== 'deleted' && task.id !== current.id && task.blockedBy.includes(current.id))
          if (dependent !== undefined) {
            throw new TeamError(`team task "${current.id}" still blocks "${dependent.id}"`, 'TEAM_TASK_HAS_DEPENDENTS')
          }
          next = { ...current, status: 'deleted' }
          break
        }
        /* v8 ignore next 2 -- TeamTaskAction is closed and every member is handled above. */
        default:
          throw new TeamError(`unsupported task action ${String(request.action)}`, 'TEAM_INVALID_ARGUMENT')
      }
      const task: TeamTaskSnapshot = {
        ...next,
        revision: current.revision + 1,
      }
      assertTaskCounterTransition(current, task)
      this.assertTaskGraph(state, task)
      await this.journal.appendAndFlush(root, 'team/task', { version: 1, teamId: TeamId(root.id), task })
      return this.taskView(root, state, task, now)
    })
  }

  /** Validate and de-duplicate dependency ids against the current task graph. */
  private dependencies(
    values: readonly TeamTaskId[],
    state: TeamFoldState,
    self?: TeamTaskId,
  ): TeamTaskId[] {
    const seen = new Set<TeamTaskId>()
    const result: TeamTaskId[] = []
    for (const id of values) {
      if (id === self) throw new TeamError('a team task cannot block itself', 'TEAM_TASK_DEPENDENCY_CYCLE')
      if (seen.has(id)) throw new TeamError(`duplicate blocker "${id}"`, 'TEAM_INVALID_ARGUMENT')
      const task = state.tasks.get(id)
      if (task === undefined || task.status === 'deleted') {
        throw new TeamError(`blocker task "${id}" not found`, 'TEAM_TASK_NOT_FOUND')
      }
      seen.add(id)
      result.push(id)
    }
    return result
  }

  /** Normalize and de-duplicate task write scopes. */
  private writeScopes(values: readonly string[]): string[] {
    return [...new Set(values.map(writeScope))]
  }

  /** Map shared task-graph validation onto stable command error codes. */
  private assertTaskGraph(state: TeamFoldState, candidate: TeamTaskSnapshot): void {
    try {
      assertTaskGraphCandidate(state.tasks, candidate)
    } catch (error: unknown) {
      /* v8 ignore next -- the shared validator is the only statement in the try and throws this exact error. */
      if (!(error instanceof TeamTaskGraphError)) throw error
      throw new TeamError(error.message, TASK_GRAPH_ERROR_CODES[error.violation], { cause: error })
    }
  }

  /** Whether all current blockers completed. */
  private taskReady(state: TeamFoldState, task: TeamTaskSnapshot): boolean {
    return task.blockedBy.every(id => state.tasks.get(id)?.status === 'completed')
  }

  /** Assign an owner while retaining append-only task authorship. */
  private withOwner(
    task: TeamTaskSnapshot,
    ownerId: SessionId,
    fields: Partial<Pick<TeamTaskSnapshot, 'leaseExpiresAt'>> = {},
  ): TeamTaskSnapshot {
    return {
      ...task,
      ...fields,
      status: 'in_progress',
      ownerId,
      authorIds: isTaskAuthor(task, ownerId) ? task.authorIds : [...task.authorIds, ownerId],
    }
  }

  /** Remove an optional owner field under exactOptionalPropertyTypes. */
  private withoutOwner(task: TeamTaskSnapshot): TeamTaskSnapshot {
    const { ownerId: _ownerId, leaseExpiresAt: _leaseExpiresAt, ...without } = task
    return without
  }

  /** Remove an optional lease field under exactOptionalPropertyTypes. */
  private withoutLease(task: TeamTaskSnapshot): TeamTaskSnapshot {
    const { leaseExpiresAt: _leaseExpiresAt, ...without } = task
    return without
  }

  /**
   * Build one task view with owner name, readiness, and advisory write overlaps.
   * A committing caller may pass its pre-append fold because `task` supplies the
   * new value explicitly; owner names, blocker readiness, and other task scopes
   * do not change when that snapshot is appended.
   */
  private taskView(root: Agent, state: TeamFoldState, task: TeamTaskSnapshot, now: number): TeamTaskView {
    const ownerName = task.ownerId === undefined
      ? undefined
      : task.ownerId === root.id
        ? 'lead'
        : state.members.get(task.ownerId)?.name
    const warnings = new Set<string>()
    for (const other of state.tasks.values()) {
      if (other.id === task.id || other.status !== 'in_progress') continue
      if (task.writeScopes.some(left => other.writeScopes.some(right => scopesOverlap(left, right)))) {
        warnings.add(`write scopes overlap with ${other.id}`)
      }
    }
    return {
      id: task.id,
      revision: task.revision,
      subject: task.subject,
      description: task.description,
      status: task.status,
      ...task.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: task.leaseExpiresAt },
      leaseExpired: task.leaseExpiresAt !== undefined && now > task.leaseExpiresAt,
      attempts: task.attempts,
      stagnation: task.stagnation,
      blockedBy: structuredClone(task.blockedBy),
      writeScopes: structuredClone(task.writeScopes),
      ...task.receipt === undefined ? {} : { receipt: structuredClone(task.receipt) },
      ...ownerName === undefined ? {} : { ownerName },
      ready: task.status === 'pending' && this.taskReady(state, task),
      writeScopeWarnings: [...warnings],
    }
  }
}
