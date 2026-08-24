/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-experimental-agent-team-external-cli`.
 * @module @deepseek-ai/dsh-experimental-agent-team-external-cli/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-agent-team-external-cli'

/** Cordis companion plugin name. */
export const name = 'experimental-agent-team-external-cli-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: roster and mailbox records belong to Agent Teams,
 * while subprocess lifetime belongs to the subprocess service.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
