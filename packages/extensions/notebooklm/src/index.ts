/**
 * Google NotebookLM integration for DSH-X via local `nlm` CLI.
 *
 * @module @deepseek-ai/dsh-notebooklm
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  addSourceText,
  addSourceUrl,
  createNotebook,
  findNlmBinary,
  listNotebooks,
  listSources,
  queryNotebook,
  runDoctor,
} from './cli.ts'
import { NOTEBOOKLM_PAGE } from './page.ts'
import { createNotebookLmListTool, createNotebookLmQueryTool } from './tools.ts'
import type {
  NlmCreateNotebookResponse,
  NlmDoctorResult,
  NlmNotebook,
  NlmQueryResponse,
  NlmSource,
  NotebookListSnapshot,
} from './types.ts'

export { createNotebookLmQueryTool, createNotebookLmListTool } from './tools.ts'
export type { ToolConfig } from './tools.ts'
export {
  findNlmBinary,
  listNotebooks,
  listSources,
  queryNotebook,
  createNotebook,
  addSourceUrl,
  addSourceText,
  describeNotebook,
  runDoctor,
} from './cli.ts'
export type {
  NlmNotebook,
  NlmSource,
  NlmReference,
  NlmQueryResponse,
  NlmCreateNotebookResponse,
  NlmNotebookDescription,
  NlmDoctorResult,
  NotebookListSnapshot,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    notebooklm: NotebookLMService
  }
}

/** Configuration for NotebookLM service. */
export interface NotebookLMConfig {
  /** Optional custom path to nlm binary. */
  nlmPath?: string
  /** Whether to register model-facing tools on ctx.tools (default true). */
  registerTools?: boolean
}

export const Config: z<NotebookLMConfig> = z.object({
  nlmPath: z.string(),
  registerTools: z.boolean().default(true),
})

/** Service providing Google NotebookLM functionality in DSH-X. */
export class NotebookLMService extends Service {
  static inject = ['webServer', 'tools']
  static Config = Config

  constructor(ctx: Context, private readonly config: NotebookLMConfig = {}) {
    super(ctx, 'notebooklm')
  }

  /**
   * Return the list of notebooks from the local nlm CLI.
   * @param force - Whether to bypass the in-memory cache.
   * @returns The list of notebooks.
   */
  async listNotebooks(force: boolean = false): Promise<NlmNotebook[]> {
    return listNotebooks({
      customPath: this.config.nlmPath,
      forceRefresh: force,
    })
  }

  /**
   * Return sources for a specific notebook.
   * @param notebookId - Notebook UUID or alias.
   * @returns The list of sources in the notebook.
   */
  async listSources(notebookId: string): Promise<NlmSource[]> {
    return listSources(notebookId, {
      customPath: this.config.nlmPath,
    })
  }

  /**
   * Query a notebook with a question.
   * @param notebookId - Notebook UUID or alias.
   * @param question - Question string.
   * @param conversationId - Optional conversation ID for follow-up turns.
   * @returns The query answer with citations.
   */
  async queryNotebook(
    notebookId: string,
    question: string,
    conversationId?: string,
  ): Promise<NlmQueryResponse> {
    return queryNotebook(notebookId, question, {
      conversationId,
      customPath: this.config.nlmPath,
    })
  }

  /**
   * Create a new notebook.
   * @param title - Title of the new notebook.
   * @returns Created notebook metadata.
   */
  async createNotebook(title: string): Promise<NlmCreateNotebookResponse> {
    return createNotebook(title, {
      customPath: this.config.nlmPath,
    })
  }

  /**
   * Add a source (URL or text) to a notebook.
   * @param notebookId - Notebook UUID.
   * @param type - Source type ('url' or 'text').
   * @param content - URL or text string.
   * @param title - Optional title for text source.
   * @returns Success status and confirmation message.
   */
  async addSource(
    notebookId: string,
    type: 'url' | 'text',
    content: string,
    title?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (type === 'url') {
      return addSourceUrl(notebookId, content, { customPath: this.config.nlmPath })
    }
    return addSourceText(notebookId, content, title, { customPath: this.config.nlmPath })
  }

  /**
   * Check CLI health and authentication.
   * @returns Health status and auth info.
   */
  async doctor(): Promise<NlmDoctorResult> {
    return runDoctor({ customPath: this.config.nlmPath })
  }

  /** Register HTTP routes and model tools on boot. */
  [Service.init](): void {
    const nlmPathConfig = this.config.nlmPath

    // 1. Model-facing Tools
    if (this.config.registerTools !== false) {
      const queryTool = createNotebookLmQueryTool({ nlmPath: nlmPathConfig })
      const listTool = createNotebookLmListTool({ nlmPath: nlmPathConfig })
      this.ctx.effect(() => this.ctx.tools.register(queryTool), 'notebooklm: query tool')
      this.ctx.effect(() => this.ctx.tools.register(listTool), 'notebooklm: list tool')
    }

    // 2. Web Routes
    const pageRoute: WebRoute = {
      kind: 'exact',
      path: '/notebooklm',
      handler: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(NOTEBOOKLM_PAGE)
      },
    }

    const notebooksApiRoute: WebRoute = {
      kind: 'exact',
      path: '/notebooklm/api/notebooks',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody<{ title?: string }>(req)
            if (!body.title || body.title.trim().length === 0) {
              sendJson(res, 400, { error: 'title is required' })
              return
            }

            const created = await this.createNotebook(body.title.trim())
            sendJson(res, 200, created)
          } catch (err) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
          }
          return
        }

        const url = new URL(req.url ?? '/', 'http://localhost')
        const force = url.searchParams.get('refresh') === '1'
        try {
          const cliPath = await findNlmBinary(nlmPathConfig)
          const notebooks = await this.listNotebooks(force)
          const snapshot: NotebookListSnapshot = {
            checkedAt: new Date().toISOString(),
            notebooks,
            cached: !force,
            cliPath,
          }
          sendJson(res, 200, snapshot)
        } catch (err) {
          const cliPath = await findNlmBinary(nlmPathConfig)
          sendJson(res, 200, {
            checkedAt: new Date().toISOString(),
            notebooks: [],
            cached: false,
            error: err instanceof Error ? err.message : String(err),
            cliPath,
          })
        }
      },
    }

    const queryApiRoute: WebRoute = {
      kind: 'exact',
      path: '/notebooklm/api/query',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const body = await readJsonBody<{
            notebookId?: string
            question?: string
            conversationId?: string
          }>(req)

          if (!body.notebookId || !body.question) {
            sendJson(res, 400, { error: 'notebookId and question are required' })
            return
          }

          const response = await this.queryNotebook(body.notebookId, body.question, body.conversationId)
          sendJson(res, 200, response)
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    }

    const addSourceApiRoute: WebRoute = {
      kind: 'exact',
      path: '/notebooklm/api/sources',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        try {
          const body = await readJsonBody<{
            notebookId?: string
            type?: 'url' | 'text'
            content?: string
            title?: string
          }>(req)

          if (!body.notebookId || !body.type || !body.content) {
            sendJson(res, 400, { error: 'notebookId, type, and content are required' })
            return
          }

          const added = await this.addSource(body.notebookId, body.type, body.content, body.title)
          sendJson(res, 200, added)
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    }

    const doctorApiRoute: WebRoute = {
      kind: 'exact',
      path: '/notebooklm/api/doctor',
      handler: async (_req, res) => {
        try {
          const doc = await this.doctor()
          sendJson(res, 200, doc)
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    }

    this.ctx.effect(() => this.ctx.webServer.register(pageRoute), 'notebooklm: page route')
    this.ctx.effect(() => this.ctx.webServer.register(notebooksApiRoute), 'notebooklm: notebooks list api')
    this.ctx.effect(() => this.ctx.webServer.register(queryApiRoute), 'notebooklm: query api')
    this.ctx.effect(() => this.ctx.webServer.register(addSourceApiRoute), 'notebooklm: add source api')
    this.ctx.effect(() => this.ctx.webServer.register(doctorApiRoute), 'notebooklm: doctor api')
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk))
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk)
    }
  }
  const text = Buffer.concat(chunks).toString('utf8')
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

export default NotebookLMService
