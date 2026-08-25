/** Package-owned invariant companion for `@deepseek-ai/dsh-live-agent-view`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-live-agent-view'

/** Cordis companion plugin name. */
export const name = 'rome-live-agent-view-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this package only projects existing live state. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
