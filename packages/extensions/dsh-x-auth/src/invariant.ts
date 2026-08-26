/** Package-owned invariant companion. @module @deepseek-ai/dsh-x-auth/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-x-auth'

/** Cordis companion plugin name. */
export const name = 'dsh-x-auth-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: the package owns no runtime state, only per-request pure decisions over an incoming request. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
