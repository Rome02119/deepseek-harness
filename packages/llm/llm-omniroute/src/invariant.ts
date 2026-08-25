/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-omniroute`.
 * @module @deepseek-ai/dsh-llm-omniroute/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-omniroute'

/** Cordis companion plugin name. */
export const name = 'llm-omniroute-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at the LLM registry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
