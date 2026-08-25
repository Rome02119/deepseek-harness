/** Package-owned invariant companion. @module @deepseek-ai/dsh-x-ui/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-x-ui'

/** Cordis companion plugin name. */
export const name = 'dsh-x-ui-invariant'
/** Required service. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
