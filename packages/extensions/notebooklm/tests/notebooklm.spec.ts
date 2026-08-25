import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import {
  createNotebookLmListTool,
  createNotebookLmQueryTool,
  findNlmBinary,
  listNotebooks,
  listSources,
  NotebookLMService,
  queryNotebook,
  type NotebookListSnapshot,
} from '../src/index.ts'

describe('@deepseek-ai/dsh-notebooklm', () => {
  it('locates local nlm CLI executable', async () => {
    const bin = await findNlmBinary()
    expect(typeof bin).toBe('string')
    expect(bin.length).toBeGreaterThan(0)
  })

  it('lists real notebooks from local nlm CLI', async () => {
    const notebooks = await listNotebooks()
    expect(Array.isArray(notebooks)).toBe(true)
    expect(notebooks.length).toBeGreaterThan(0)
    const first = notebooks[0]
    expect(first).toBeDefined()
    if (first) {
      expect(typeof first.id).toBe('string')
      expect(typeof first.title).toBe('string')
      expect(typeof first.source_count).toBe('number')
    }
  })

  it('lists sources for a real notebook', async () => {
    const notebooks = await listNotebooks()
    expect(notebooks.length).toBeGreaterThan(0)
    const nbWithSources = notebooks.find(n => n.source_count > 0) ?? notebooks[0]
    expect(nbWithSources).toBeDefined()
    if (nbWithSources) {
      const sources = await listSources(nbWithSources.id)
      expect(Array.isArray(sources)).toBe(true)
    }
  })

  it('queries a real notebook and gets structured answer', async () => {
    const notebooks = await listNotebooks()
    const antigravityNb = notebooks.find(n => (n.title || '').includes('Antigravity') && n.source_count > 0)
    if (antigravityNb) {
      const res = await queryNotebook(antigravityNb.id, 'What is Antigravity in 1 sentence?')
      expect(res).toBeDefined()
      expect(typeof res.answer).toBe('string')
      expect(res.answer.length).toBeGreaterThan(0)
      expect(Array.isArray(res.sources_used)).toBe(true)
    }
  }, 30000)

  it('defines valid model-facing tools', async () => {
    const queryTool = createNotebookLmQueryTool()
    expect(queryTool.name).toBe('notebooklm_query')
    expect(queryTool.parameters).toBeDefined()
    expect(queryTool.output).toBeDefined()
    expect(typeof queryTool.execute).toBe('function')

    const listTool = createNotebookLmListTool()
    expect(listTool.name).toBe('notebooklm_list')
    expect(listTool.parameters).toBeDefined()
    expect(listTool.output).toBeDefined()
    expect(typeof listTool.execute).toBe('function')
  })

  it('boots service in cordis context and serves routes', async () => {
    const ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NotebookLMService)

    expect(ctx.get('notebooklm')).toBeDefined()
    const port = ctx.webServer.port
    expect(port).toBeGreaterThan(0)

    // Check HTML route
    const pageRes = await fetch(`http://127.0.0.1:${port}/notebooklm`)
    expect(pageRes.status).toBe(200)
    const html = await pageRes.text()
    expect(html).toContain('NotebookLM')
    expect(html).toContain('local nlm CLI')

    // Check JSON API route
    const apiRes = await fetch(`http://127.0.0.1:${port}/notebooklm/api/notebooks`)
    expect(apiRes.status).toBe(200)
    const json = (await apiRes.json()) as NotebookListSnapshot
    expect(Array.isArray(json.notebooks)).toBe(true)
    expect(json.notebooks.length).toBeGreaterThan(0)

    await ctx.fiber.dispose()
  })
})
