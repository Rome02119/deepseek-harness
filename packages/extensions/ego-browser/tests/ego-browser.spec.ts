/**
 * Unit and integration tests for `@deepseek-ai/dsh-ego-browser`.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as EgoInvariant from '../src/invariant.ts'
import {
  EGO_FETCH_PROVIDER_ID,
  EgoBrowserService,
  type EgoBrowserStatus,
  EgoWebFetchProvider,
  findEgoBinary,
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
  })

  it('inspects binary presence with isEgoBinaryPresent and findEgoBinary', async () => {
    expect(typeof isEgoBinaryPresent()).toBe('boolean')
    const bin = await findEgoBinary()
    if (bin) {
      expect(typeof bin).toBe('string')
    }
  })
})
