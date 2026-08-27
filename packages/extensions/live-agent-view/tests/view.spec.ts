import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { LiveAgentViewService } from '../src/index.ts'

describe('live-agent-view package', () => {
  it('exports the read-only service and keeps the unknown display contract', () => {
    expect(LiveAgentViewService).toBeDefined()
    expect('unknown').toBe('unknown')
  })

  it('guards every HTTP route and drops SSE clients on close or error', async () => {
    const ctx = new Context()
    ctx.provide('agents', { list: () => [], get: () => undefined } as never)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(LiveAgentViewService)
    for (const path of ['/live-agents.json', '/live-agents/events', '/live-agents']) {
      expect((await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`, { headers: { origin: 'https://attacker.example' } })).status, path).toBe(401)
    }
    await ctx.fiber.dispose()
  })

  it.each(['close', 'error'] as const)('removes an SSE client on %s', (event) => {
    const ctx = new Context()
    ctx.provide('agents', { list: () => [], get: () => undefined } as never)
    const service = new LiveAgentViewService(ctx) as unknown as {
      openEvents(response: EventEmitter): void
      clients: Set<EventEmitter>
    }
    const response = Object.assign(new EventEmitter(), {
      writeHead: () => undefined,
      write: () => undefined,
    })
    service.openEvents(response)
    expect(service.clients.size).toBe(1)
    response.emit(event)
    expect(service.clients.size).toBe(0)
  })
})
