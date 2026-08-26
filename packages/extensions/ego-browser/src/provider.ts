/**
 * Web capability provider registering ego-browser as a WebFetchProvider on ctx.web.
 *
 * @module @deepseek-ai/dsh-ego-browser/provider
 */

import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import { isEgoBinaryPresent, navigateUrl } from './cli.ts'

/** The provider identifier registered on `ctx.web`. */
export const EGO_FETCH_PROVIDER_ID = 'ego-browser'

/** Options configuring the Ego browser fetch provider. */
export interface EgoFetchProviderLimits {
  egoPath?: string
  timeoutMs?: number
  maxBodyChars?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BODY_CHARS = 100_000

/**
 * WebFetchProvider implementation backed by ego-browser.
 *
 * It opens the requested URL in an isolated task space ('dsh-web-fetch'),
 * waits for the page to render, and returns the rendered HTML content.
 */
export class EgoWebFetchProvider implements WebFetchProvider {
  readonly id = EGO_FETCH_PROVIDER_ID

  private readonly egoPath: string | undefined
  private readonly timeoutMs: number
  private readonly maxBodyChars: number

  constructor(limits: EgoFetchProviderLimits = {}) {
    this.egoPath = limits.egoPath
    this.timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxBodyChars = limits.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS
  }

  /**
   * Cheap synchronous check to verify if ego-browser is available on the machine.
   */
  available(): boolean {
    return isEgoBinaryPresent(this.egoPath)
  }

  /**
   * Fetch and render a URL using ego-browser.
   *
   * @param request - The fetch request containing the URL.
   * @param signal - Optional AbortSignal for cancellation.
   * @returns The rendered WebFetchResult.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (!this.available()) {
      throw new WebError(
        'ego-browser is not installed or not available on PATH. Run onboarding in ego lite.app.',
        'WEB_PROVIDER_UNAVAILABLE',
      )
    }

    try {
      const res = await navigateUrl(request.url, {
        taskSpaceName: 'dsh-web-fetch',
        ...this.egoPath !== undefined ? { customPath: this.egoPath } : {},
        timeoutMs: this.timeoutMs,
        ...signal !== undefined ? { signal } : {},
      })

      if (!res.success) {
        throw new WebError(
          `ego-browser failed to load "${request.url}": ${res.error ?? 'unknown error'}`,
          'WEB_FETCH_FAILED',
        )
      }

      const content = res.html || res.snapshot || ''
      const truncated = content.length > this.maxBodyChars
      const finalContent = truncated ? content.slice(0, this.maxBodyChars) : content

      return {
        url: res.url,
        statusCode: 200,
        body: {
          kind: 'html',
          content: finalContent,
        },
        truncated,
      }
    } catch (err) {
      if (err instanceof WebError) throw err
      if (signal?.aborted) {
        throw new WebError('ego-browser fetch aborted', 'WEB_ABORTED', { cause: err })
      }
      throw new WebError(
        `ego-browser fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        'WEB_FETCH_ERROR',
        { cause: err },
      )
    }
  }
}
