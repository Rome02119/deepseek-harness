/** Write scope enforcement for Agent Teams over the filesystem seam. */

import { isAbsolute, relative } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import type { TeamRoster } from './roster.ts'
import { writeScope } from './validation.ts'

/** Target file representation for write-scope enforcement. */
export interface WriteScopeTarget {
  /** Path for model/UI-facing output. */
  readonly displayPath: string
}

/**
 * Normalize a target display path to a workspace-relative slash-separated path.
 * @param displayPath - resolved display path from the filesystem target.
 * @param cwd - optional workspace root directory.
 * @returns normalized slash-separated relative path without leading/trailing slashes.
 */
export function normalizeRelativePath(displayPath: string, cwd?: string): string {
  let normalized = displayPath.replaceAll('\\', '/')
  if (cwd !== undefined && isAbsolute(displayPath)) {
    normalized = relative(cwd, displayPath).replaceAll('\\', '/')
  }
  return normalized.replace(/^\.\//u, '').replace(/^\/+/u, '').replace(/\/+$/u, '')
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

/**
 * Assert that a filesystem mutation target is within the write scopes of the agent's in-progress task.
 * @param roster - Team roster used to resolve membership.
 * @param journal - Team journal used to query task state.
 * @param target - resolved filesystem target.
 * @param actor - opaque tool execution actor carrying the agent.
 */
export function assertWriteScope(
  roster: TeamRoster,
  journal: TeamJournal,
  target: WriteScopeTarget,
  actor: object | undefined,
): void {
  const agent = actor !== undefined && 'agent' in actor ? (actor.agent as Agent | undefined) : undefined
  if (agent === undefined) return
  const membership = roster.tryMembership(agent)
  if (membership === undefined) return

  const state = journal.state(membership.root)
  const inProgressTasks = [...state.tasks.values()].filter(
    task => task.status === 'in_progress' && task.ownerId === agent.id,
  )
  const scopedTasks = inProgressTasks.filter(task => task.writeScopes.length > 0)
  if (scopedTasks.length === 0) return

  const allowedScopes = scopedTasks.flatMap(task => task.writeScopes)
  const cwd = agent.session.header.cwd
  const normalizedPath = normalizeRelativePath(target.displayPath, cwd)
  const allowed = allowedScopes.some(scope => isPathInScope(normalizedPath, scope))
  if (!allowed) {
    throw new TeamError(
      `cannot write "${target.displayPath}": path is outside declared write scopes [${allowedScopes.map(s => JSON.stringify(s)).join(', ')}]`,
      'TEAM_OUT_OF_SCOPE_WRITE',
    )
  }
}
