/** Package-owned invariant companion for `@deepseek-ai/dsh-x-command-center`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-x-command-center'

/** Cordis companion plugin name. */
export const name = 'dsh-x-command-center-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this package routes user actions through existing Team services. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
