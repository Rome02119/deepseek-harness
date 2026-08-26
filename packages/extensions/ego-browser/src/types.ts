/**
 * Types and vocabulary for `@deepseek-ai/dsh-ego-browser`.
 *
 * @module @deepseek-ai/dsh-ego-browser/types
 */

/** One task space in ego-browser. */
export interface EgoTaskSpace {
  readonly id: number | string
  readonly name?: string
  readonly ownership?: string
  readonly activeTabId?: string
  readonly tabsCount?: number
}

/** One tab inside an ego-browser task space. */
export interface EgoTabInfo {
  readonly targetId: string
  readonly url: string
  readonly title: string
}

/** JSON snapshot of ego-browser status and capability in DSH-X. */
export interface EgoBrowserStatus {
  readonly checkedAt: string
  readonly installed: boolean
  readonly running: boolean
  readonly cliPath?: string
  readonly version?: string
  readonly providerId: string
  readonly providerRegistered: boolean
  readonly activeInWebSeam: boolean
  readonly currentFetchProvider: string
  readonly taskSpaces: readonly EgoTaskSpace[]
  readonly error?: string
}

/** Result of executing a script inside ego-browser. */
export interface EgoEvalResult {
  readonly success: boolean
  readonly output: string
  readonly error?: string
  readonly durationMs: number
}

/** Result of navigating to a URL with ego-browser. */
export interface EgoNavigateResult {
  readonly success: boolean
  readonly url: string
  readonly title?: string
  readonly snapshot?: string
  readonly html?: string
  readonly taskSpaceId?: number | string
  readonly error?: string
}
