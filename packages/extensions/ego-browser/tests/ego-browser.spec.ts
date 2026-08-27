/**
 * Unit and integration tests for `@deepseek-ai/dsh-ego-browser`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as EgoInvariant from '../src/invariant.ts'
import {
  EGO_FETCH_PROVIDER_ID,
  EgoBrowserService,
  type EgoBrowserStatus,
  EgoWebFetchProvider,
  findEgoBinary,
  getEgoVersion,
  isEgoBinaryPresent,
} from '../src/index.ts'
import {
  createEgoBrowserNavigateTool,
  createEgoBrowserTaskSpacesTool,
} from '../src/tools.ts'

describe('@deepseek-ai/dsh-ego-browser', () => {
  it('registers invariant companion without errors', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants, { enabled: true })
    await ctx.plugin(EgoInvariant)
    expect(EgoInvariant.name).toBe('rome-ego-browser-invariant')
    await ctx.fiber.dispose()
  })

  it('initializes service and registers fetch provider on ctx.web', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(EgoBrowserService, { registerFetchProvider: true, registerTools: true })

    expect(ctx.get('egoBrowser')).toBeInstanceOf(EgoBrowserService)

    // The fetch provider is registered on ctx.web
    const provider = new EgoWebFetchProvider()
    expect(provider.id).toBe(EGO_FETCH_PROVIDER_ID)
    expect(typeof provider.available()).toBe('boolean')

    await ctx.fiber.dispose()
  })

  it('serves /ego-browser HTML and /ego-browser/api/status endpoints', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(EgoBrowserService)

    const port = ctx.webServer.port
    expect(port).toBeGreaterThan(0)

    // HTML route
    const pageRes = await fetch(`http://127.0.0.1:${port}/ego-browser`)
    expect(pageRes.status).toBe(200)
    const html = await pageRes.text()
    expect(html).toContain('ego-browser')
    expect(html).toContain('DSH-X')

    // Status API route
    const statusRes = await fetch(`http://127.0.0.1:${port}/ego-browser/api/status`)
    expect(statusRes.status).toBe(200)
    const statusJson = (await statusRes.json()) as EgoBrowserStatus
    expect(statusJson.providerId).toBe('ego-browser')
    expect(typeof statusJson.installed).toBe('boolean')

    await ctx.fiber.dispose()
  })

  it('refuses untokenised tailnet access to every ego-browser route', async () => {
    const token = 'a'.repeat(64)
    const previousToken = process.env.DSH_X_TOKEN
    process.env.DSH_X_TOKEN = token
    const routes = new Map<string, WebRoute['handler']>()
    const ctx = new Context()
    ctx.provide('webServer', { register: (route: WebRoute) => { routes.set(route.path, route.handler); return () => {} } } as never)
    ctx.provide('tools', {} as never)
    ctx.provide('web', {} as never)
    const server = createServer((req, res) => {
      const handler = routes.get(new URL(req.url ?? '/', 'http://dsh-x.invalid').pathname)
      if (handler === undefined) { res.writeHead(404); res.end(); return }
      void handler(req, res)
    })
    server.on('connection', (socket) => { Object.defineProperty(socket, 'remoteAddress', { value: '100.64.0.5', configurable: true }) })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    try {
      await ctx.plugin(EgoBrowserService, { registerFetchProvider: false, registerTools: false })
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      for (const path of ['/ego-browser', '/ego-browser/api/status', '/ego-browser/api/navigate', '/ego-browser/api/eval', '/ego-browser/api/select-provider']) {
        expect((await fetch(`${origin}${path}`)).status, path).toBe(401)
      }
    } finally {
      await ctx.fiber.dispose()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      if (previousToken === undefined) delete process.env.DSH_X_TOKEN
      else process.env.DSH_X_TOKEN = previousToken
    }
  })

  it('provides model-facing tools with proper schemas', () => {
    const navTool = createEgoBrowserNavigateTool()
    expect(navTool.name).toBe('ego_browser_navigate')
    expect(navTool.parameters).toBeDefined()

    const spacesTool = createEgoBrowserTaskSpacesTool()
    expect(spacesTool.name).toBe('ego_browser_taskspaces')
    expect(spacesTool.parameters).toBeDefined()

    const presentation = navTool.presentCall?.({ url: 'https://example.com' })
    expect(presentation?.title).toContain('https://example.com')
  })

  it('renders tool output for navigate and taskspaces', () => {
    const navTool = createEgoBrowserNavigateTool()
    const renderedSuccess = navTool.output?.render?.({}, {
      success: true,
      url: 'https://example.com',
      title: 'Example Domain',
      snapshot: 'This is example content',
    })
    const firstBlock = renderedSuccess?.[0]
    expect(firstBlock).toBeDefined()
    if (firstBlock && firstBlock.type === 'text') {
      expect(firstBlock.text).toContain('Example Domain')
      expect(firstBlock.text).toContain('This is example content')
    }

    const renderedFail = navTool.output?.render?.({}, {
      success: false,
      error: 'Network unreachable',
    })
    const failBlock = renderedFail?.[0]
    if (failBlock && failBlock.type === 'text') {
      expect(failBlock.text).toContain('Failed to navigate')
    }

    const spacesTool = createEgoBrowserTaskSpacesTool()
    const renderedSpaces = spacesTool.output?.render?.({}, [
      { id: 1, name: 'Task 1', ownership: 'agent' },
    ])
    const spaceBlock = renderedSpaces?.[0]
    if (spaceBlock && spaceBlock.type === 'text') {
      expect(spaceBlock.text).toContain('Task 1')
    }
  })

  it('handles provider selection via selectFetchProvider', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(EgoBrowserService)
    const service = ctx.get('egoBrowser') as EgoBrowserService
    expect(service).toBeDefined()
    service.selectFetchProvider('ego-browser')
    const status = await service.status()
    expect(status.activeInWebSeam).toBe(true)
    expect(status.currentFetchProvider).toBe('ego-browser')

    service.selectFetchProvider('http')
    const statusHttp = await service.status()
    expect(statusHttp.activeInWebSeam).toBe(false)
    expect(statusHttp.currentFetchProvider).toBe('http')

    await ctx.fiber.dispose()
  }, 30_000)

  it('inspects binary presence with isEgoBinaryPresent and findEgoBinary', async () => {
    expect(typeof isEgoBinaryPresent()).toBe('boolean')
    const bin = await findEgoBinary()
    if (bin) {
      expect(typeof bin).toBe('string')
    }
  })

  // Regression: status() probes spawned child processes with NO timeout, so a
  // wedged ego binary hung the whole call. Under the full suite this surfaced as
  // "Test timed out in 5000ms". Every probe is now bounded.
  it('does not hang when the ego binary never exits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ego-probe-'))
    const wedged = join(dir, 'ego-browser')
    writeFileSync(wedged, '#!/bin/sh\nsleep 60\n', { mode: 0o755 })
    try {
      const started = Date.now()
      const version = await getEgoVersion(wedged, 300)
      const elapsed = Date.now() - started
      expect(version).toBeUndefined()
      expect(elapsed).toBeLessThan(3_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 10_000)
})
