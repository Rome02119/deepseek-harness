/** Package-owned invariant companion for `@deepseek-ai/dsh-terminal-herdr`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-terminal-herdr'

/** Cordis companion plugin name. */
export const name = 'terminal-herdr-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: herdr is an external process supervised by its own server. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
