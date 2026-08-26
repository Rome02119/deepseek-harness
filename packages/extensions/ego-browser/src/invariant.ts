/** Package-owned invariant companion for `@deepseek-ai/dsh-ego-browser`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ego-browser'

/** Cordis companion plugin name. */
export const name = 'rome-ego-browser-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this package provides HTTP, web seam provider, and model tool access to the local ego-browser CLI. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
