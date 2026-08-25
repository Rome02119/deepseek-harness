/** Package-owned invariant companion for `@deepseek-ai/dsh-subscription-quota`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subscription-quota'

/** Cordis companion plugin name. */
export const name = 'rome-subscription-quota-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this package only projects read-only external observations. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
