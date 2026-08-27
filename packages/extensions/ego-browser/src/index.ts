/**
 * ego-browser integration for DSH-X: selectable browser provider on ctx.web,
 * interactive management page at /ego-browser, and automation tools.
 *
 * @module @deepseek-ai/dsh-ego-browser
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { DshXBodyTooLargeError, dshXAuth, readDshXBody } from '@deepseek-ai/dsh-x-auth'
import type {} from '@deepseek-ai/dsh-web'
import {
  findEgoBinary,
  getEgoVersion,
  isEgoAppRunning,
  listTaskSpaces,
  navigateUrl,
  runEgoScript,
} from './cli.ts'
import { EGO_BROWSER_PAGE } from './page.ts'
import { EGO_FETCH_PROVIDER_ID, EgoWebFetchProvider } from './provider.ts'
import {
  createEgoBrowserNavigateTool,
  createEgoBrowserTaskSpacesTool,
} from './tools.ts'
import type {
  EgoBrowserStatus,
  EgoEvalResult,
  EgoNavigateResult,
  EgoTaskSpace,
} from './types.ts'

export { EGO_FETCH_PROVIDER_ID, EgoWebFetchProvider } from './provider.ts'
export type { EgoFetchProviderLimits } from './provider.ts'
export {
  createEgoBrowserNavigateTool,
  createEgoBrowserTaskSpacesTool,
} from './tools.ts'
export type { ToolConfig } from './tools.ts'
export {
  findEgoBinary,
  isEgoAvailable,
  isEgoBinaryPresent,
  isEgoAppRunning,
  getEgoVersion,
  runEgoScript,
  listTaskSpaces,
  navigateUrl,
} from './cli.ts'
export type {
  EgoTaskSpace,
  EgoTabInfo,
  EgoBrowserStatus,
  EgoEvalResult,
  EgoNavigateResult,
} from './types.ts'


/** Plugin configuration for ego-browser. */
export interface EgoBrowserConfig {
  /** Optional custom path to ego-browser binary executable. */
  egoPath?: string
  /** Whether to register EgoWebFetchProvider on ctx.web (default true). */
  registerFetchProvider?: boolean
  /** Whether to register model-facing tools on ctx.tools (default true). */
  registerTools?: boolean
  /** Operation timeout in milliseconds (default 30000). */
  timeoutMs?: number
  /** Maximum decoded body length in characters (default 100000). */
  maxBodyChars?: number
}

export const Config: z<EgoBrowserConfig> = z.object({
  egoPath: z.string(),
  registerFetchProvider: z.boolean().default(true),
  registerTools: z.boolean().default(true),
  timeoutMs: z.number().default(30_000),
  maxBodyChars: z.number().default(100_000),
})

/** Stable Cordis plugin name. */
export const name = 'ego-browser'

/** Services required by the ego-browser extension. */
export const inject = ['webServer', 'tools', 'web']

/** Service providing ego-browser integration in DSH-X. */
export class EgoBrowserService extends Service {
  static inject = inject
  static Config = Config

  private activeFetchProviderOverride?: string | undefined

  constructor(ctx: Context, private readonly config: EgoBrowserConfig = {}) {
    super(ctx, 'egoBrowser')
  }

  /**
   * Return live health, runtime state, and task spaces from ego-browser.
   * @returns Snapshot of ego-browser status.
   */
  async status(): Promise<EgoBrowserStatus> {
    const cliPath = await findEgoBinary(this.config.egoPath)
    const installed = cliPath !== undefined
    const running = await isEgoAppRunning()
    const version = installed ? await getEgoVersion(this.config.egoPath) : undefined
    const taskSpaces = (installed && running) ? await this.listTaskSpaces() : []

    const currentFetchProvider = this.activeFetchProviderOverride
      ?? process.env.DSH_WEB_FETCH_PROVIDER
      ?? 'http'

    return {
      checkedAt: new Date().toISOString(),
      installed,
      running,
      ...cliPath !== undefined ? { cliPath } : {},
      ...version !== undefined ? { version } : {},
      providerId: EGO_FETCH_PROVIDER_ID,
      providerRegistered: this.config.registerFetchProvider !== false,
      activeInWebSeam: currentFetchProvider === EGO_FETCH_PROVIDER_ID,
      currentFetchProvider,
      taskSpaces,
    }
  }

  /**
   * List active task spaces in ego-browser.
   * @returns Active task spaces.
   */
  async listTaskSpaces(): Promise<EgoTaskSpace[]> {
    return listTaskSpaces({
      ...this.config.egoPath !== undefined ? { customPath: this.config.egoPath } : {},
      ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
    })
  }

  /**
   * Navigate to a URL in an isolated task space.
   * @param url - Webpage URL.
   * @param taskSpace - Task space name.
   * @returns Navigation and snapshot result.
   */
  async navigate(url: string, taskSpace?: string): Promise<EgoNavigateResult> {
    return navigateUrl(url, {
      ...taskSpace !== undefined ? { taskSpaceName: taskSpace } : {},
      ...this.config.egoPath !== undefined ? { customPath: this.config.egoPath } : {},
      ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
    })
  }

  /**
   * Run custom automation script inside ego-browser.
   * @param script - JavaScript code to run.
   * @returns Execution result.
   */
  async eval(script: string): Promise<EgoEvalResult> {
    const start = performance.now()
    try {
      const output = await runEgoScript(script, {
        ...this.config.egoPath !== undefined ? { customPath: this.config.egoPath } : {},
        ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
      })
      return {
        success: true,
        output,
        durationMs: Math.round(performance.now() - start),
      }
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - start),
      }
    }
  }

  /**
   * Set the active web fetch provider for ctx.web.
   * @param providerId - 'ego-browser' or 'http'.
   */
  selectFetchProvider(providerId: string): void {
    this.activeFetchProviderOverride = providerId
    process.env.DSH_WEB_FETCH_PROVIDER = providerId
  }

  /** Register web seam provider, HTTP routes, and model tools on boot. */
  [Service.init](): void {
    // 1. Register WebFetchProvider on ctx.web
    if (this.config.registerFetchProvider !== false) {
      const provider = new EgoWebFetchProvider({
        ...this.config.egoPath !== undefined ? { egoPath: this.config.egoPath } : {},
        ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
        ...this.config.maxBodyChars !== undefined ? { maxBodyChars: this.config.maxBodyChars } : {},
      })
      this.ctx.effect(() => this.ctx.web.registerFetchProvider(provider), 'ego-browser: web fetch provider')
    }

    // 2. Register model-facing tools on ctx.tools
    if (this.config.registerTools !== false) {
      const navTool = createEgoBrowserNavigateTool({
        ...this.config.egoPath !== undefined ? { egoPath: this.config.egoPath } : {},
        ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
      })
      const spacesTool = createEgoBrowserTaskSpacesTool({
        ...this.config.egoPath !== undefined ? { egoPath: this.config.egoPath } : {},
        ...this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {},
      })
      this.ctx.effect(() => this.ctx.tools.register(navTool), 'ego-browser: navigate tool')
      this.ctx.effect(() => this.ctx.tools.register(spacesTool), 'ego-browser: task spaces tool')
    }

    // 3. Web Routes on ctx.webServer
    const pageRoute: WebRoute = {
      kind: 'exact',
      path: '/ego-browser',
      handler: dshXAuth((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(EGO_BROWSER_PAGE)
      }),
    }

    const statusApiRoute: WebRoute = {
      kind: 'exact',
      path: '/ego-browser/api/status',
      handler: dshXAuth(async (_req, res) => {
        try {
          const s = await this.status()
          sendJson(res, 200, s)
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }),
    }

    const navigateApiRoute: WebRoute = {
      kind: 'exact',
      path: '/ego-browser/api/navigate',
      handler: dshXAuth(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const body = await readJsonBody<{ url?: string; taskSpace?: string }>(req)
          if (!body.url || body.url.trim().length === 0) {
            sendJson(res, 400, { error: 'url is required' })
            return
          }
          const result = await this.navigate(body.url.trim(), body.taskSpace?.trim())
          sendJson(res, 200, result)
        } catch (err) {
          sendJson(res, err instanceof DshXBodyTooLargeError ? 413 : 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }),
    }

    const evalApiRoute: WebRoute = {
      kind: 'exact',
      path: '/ego-browser/api/eval',
      handler: dshXAuth(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const body = await readJsonBody<{ script?: string }>(req)
          if (!body.script || body.script.trim().length === 0) {
            sendJson(res, 400, { error: 'script is required' })
            return
          }
          const result = await this.eval(body.script)
          sendJson(res, 200, result)
        } catch (err) {
          sendJson(res, err instanceof DshXBodyTooLargeError ? 413 : 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }),
    }

    const selectProviderRoute: WebRoute = {
      kind: 'exact',
      path: '/ego-browser/api/select-provider',
      handler: dshXAuth(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const body = await readJsonBody<{ providerId?: string }>(req)
          const providerId = body.providerId ?? 'ego-browser'
          this.selectFetchProvider(providerId)
          sendJson(res, 200, { success: true, activeProvider: providerId })
        } catch (err) {
          sendJson(res, err instanceof DshXBodyTooLargeError ? 413 : 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }),
    }

    this.ctx.effect(() => this.ctx.webServer.register(pageRoute), 'ego-browser: page route')
    this.ctx.effect(() => this.ctx.webServer.register(statusApiRoute), 'ego-browser: status api')
    this.ctx.effect(() => this.ctx.webServer.register(navigateApiRoute), 'ego-browser: navigate api')
    this.ctx.effect(() => this.ctx.webServer.register(evalApiRoute), 'ego-browser: eval api')
    this.ctx.effect(() => this.ctx.webServer.register(selectProviderRoute), 'ego-browser: select provider api')
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const text = (await readDshXBody(req)).toString('utf8')
  if (text.trim().length === 0) return {} as T
  return JSON.parse(text) as T
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/** Loader plugin entry point. */
export function apply(ctx: Context, config: EgoBrowserConfig = {}): void {
  new EgoBrowserService(ctx, config)
}

export default EgoBrowserService
