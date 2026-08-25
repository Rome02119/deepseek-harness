/** Package-owned invariant companion for `@deepseek-ai/dsh-notebooklm`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-notebooklm'

/** Cordis companion plugin name. */
export const name = 'rome-notebooklm-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this package provides HTTP and model tool access to the local nlm CLI. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
