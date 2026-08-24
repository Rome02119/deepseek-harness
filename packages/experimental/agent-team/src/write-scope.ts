/** Write scope enforcement for Agent Teams over the filesystem seam. */

import { relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { TeamError } from './error.ts'
import type { TeamFoldState } from './fold.ts'
import type { TeamJournal } from './journal.ts'
import type { TeamRoster } from './roster.ts'
import { writeScope } from './validation.ts'

/**
 * Normalize a target display path to a workspace-relative slash-separated path.
 * @param displayPath - resolved display path from the filesystem target.
 * @param cwd - optional workspace root directory.
 * @returns normalized slash-separated relative path without leading/trailing slashes.
 */
export function normalizeRelativePath(displayPath: string, cwd?: string): string {
  const base = resolve(cwd ?? '.')
  return relative(base, resolve(base, displayPath)).replaceAll('\\', '/').replace(/\/+$/u, '')
}

/**
 * Check whether a normalized path is inside a declared write scope prefix.
 * @param normalizedPath - normalized workspace-relative file path.
 * @param scope - normalized scope prefix.
 * @returns true if normalizedPath is exact match or child of scope.
 */
export function isPathInScope(normalizedPath: string, scope: string): boolean {
  const normalizedScope = writeScope(scope)
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`)
}

/** Return the actor's owned tasks whose current state restricts filesystem writes. */
function scopedTasks(state: TeamFoldState, agentId: string) {
  return [...state.tasks.values()].filter(task =>
    (task.status === 'in_progress' || task.status === 'in_review')
    && task.ownerId === agentId
    && task.writeScopes.length > 0)
}

/** Require one target to satisfy every task in one sampled state. */
async function assertTasksInScope(
  ctx: Context,
  tasks: ReturnType<typeof scopedTasks>,
  target: FsTarget,
  cwd: string | undefined,
): Promise<void> {
  if (tasks.length === 0) return
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('write scope enforcement requires a filesystem service')
  const options = cwd === undefined ? {} : { cwd }
  const workspace = await fs.resolve('.', options)
  for (const task of tasks) {
    const scopes = await Promise.all(task.writeScopes.map(scope => fs.resolve(scope, options)))
    if (scopes.some(scope => fs.contains(workspace, scope) && fs.contains(scope, target))) continue
    throw new TeamError(
      `cannot write "${target.displayPath}": path is outside task "${task.id}" write scopes [${task.writeScopes.map(s => JSON.stringify(s)).join(', ')}]`,
      'TEAM_OUT_OF_SCOPE_WRITE',
    )
  }
}

/**
 * Assert that a filesystem mutation target is within every active write scope of the initiating Agent.
 * The filesystem provider resolves scope roots and compares the same canonical identities used for mutation.
 * Task state is sampled before and after asynchronous resolution, and each sampled task restricts the write.
 * @param ctx - runtime context carrying the initiating Agent and filesystem provider.
 * @param roster - Team roster used to resolve membership.
 * @param journal - Team journal used to query task state.
 * @param target - resolved filesystem target.
 */
export async function assertWriteScope(
  ctx: Context,
  roster: TeamRoster,
  journal: TeamJournal,
  target: FsTarget,
): Promise<void> {
  const agent = ctx.agents.currentInitiator()
  if (agent === undefined) {
    throw new TeamError('cannot authorize filesystem write without an initiating agent', 'TEAM_UNATTRIBUTED_WRITE')
  }
  const membership = roster.tryMembership(agent)
  if (membership === undefined) return

  const cwd = agent.session.header.cwd
  const before = scopedTasks(journal.state(membership.root), agent.id)
  await assertTasksInScope(ctx, before, target, cwd)
  const after = scopedTasks(journal.state(membership.root), agent.id)
  if (before.length !== after.length || before.some((task, index) => {
    const current = after[index]
    return current === undefined
      || task.id !== current.id
      || task.revision !== current.revision
      || task.status !== current.status
      || task.ownerId !== current.ownerId
  })) {
    throw new TeamError(
      `cannot write "${target.displayPath}": task ownership or status changed during write-scope authorization`,
      'TEAM_OUT_OF_SCOPE_WRITE',
    )
  }
  await assertTasksInScope(ctx, after, target, cwd)
}
