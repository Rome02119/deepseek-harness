import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalSendOperation,
  TerminalSessionStatus,
} from '@deepseek-ai/dsh-terminal'
import DshXUiService, { MAX_CONCURRENT_PTYS } from '../src/index.ts'

const TOKEN = 'a'.repeat(64)
const TAILNET_PEER = '100.64.0.5'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  delete process.env.DSH_X_TOKEN
  for (const close of closers.splice(0)) await close()
})

class StubTerminalSession implements TerminalBackendSession {
  readonly motd = 'stub ready'
  readonly pid = 4321

  startSend(): TerminalSendOperation {
    return { done: Promise.resolve({ viewport: '', waitReason: 'stdin_read', sessionStatus: this.status(), truncated: false }), readOutput: () => ({ delta: '', truncated: false }), cancel: () => false }
  }

  read() {
    return { text: '', totalLines: 0, lineBegin: 0, lineEnd: 0, truncated: false }
  }

  async signal() {
    return { delivered: true as const, targetPgid: 1 }
  }

  status(): TerminalSessionStatus {
    return { kind: 'running' }
  }

  async close(): Promise<void> {}
}

interface Harness {
  origin: string
  created: string[]
  spawned: number
  agent: Agent
  terminals: Context['terminals']
}

/**
 * Mount the control page over the real PTY registry with a stub backend, then
 * serve its registered routes from a socket that reports a tailnet peer, so a
 * remote caller can be exercised without a second interface.
 */
async function harness(): Promise<Harness> {
  process.env.DSH_X_TOKEN = TOKEN
  const ctx = new Context()
  const routes = new Map<string, WebRoute['handler']>()
  const created: string[] = []
  const state = { spawned: 0 }
  ctx.provide('webServer', { register: (route: WebRoute) => { routes.set(route.path, route.handler); return () => {} } } as never)
  ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
  ctx.provide('loader', {
    create: (options: { name: string }) => { created.push(options.name); return Promise.resolve('entry-1') },
    entries: () => [],
  } as never)
  const agentScope = ctx.plugin(() => {})
  const agent = { id: 'dsh-x-guard', ctx: agentScope.ctx, status: 'idle' } as unknown as Agent
  ctx.provide('agents', { list: () => [agent], get: (id: string) => (id === agent.id ? agent : undefined) } as never)
  await ctx.plugin(TerminalSessionService)
  const backend: TerminalBackend = {
    type: 'shell',
    spawn: () => { state.spawned += 1; return Promise.resolve(new StubTerminalSession()) },
  }
  ctx.terminals.registerBackend(backend)

  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url ?? '/', 'http://dsh-x.invalid').pathname)
    if (handler === undefined) { res.writeHead(404); res.end(); return }
    void handler(req, res)
  })
  server.on('connection', (socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: TAILNET_PEER, configurable: true })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const fiber = await ctx.plugin(DshXUiService)
  closers.push(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await fiber.dispose()
    await agentScope.dispose()
  })
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    created,
    get spawned() { return state.spawned },
    agent,
    terminals: ctx.terminals,
  }
}

async function post(origin: string, path: string, body: unknown, token?: string): Promise<number> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...token === undefined ? {} : { authorization: `Bearer ${token}` } },
    body: JSON.stringify(body),
  })
  return response.status
}

describe('DSH-X control routes', () => {
  it('refuses an untokenised remote plugin add and never reaches the Loader', async () => {
    const h = await harness()
    expect(await post(h.origin, '/dsh-x/api/plugins/add', { name: '@evil/rce' })).toBe(401)
    expect(h.created).toEqual([])
  })

  it('accepts the same plugin add once the token is presented', async () => {
    const h = await harness()
    expect(await post(h.origin, '/dsh-x/api/plugins/add', { name: '@deepseek-ai/dsh-x-ui/demo' }, TOKEN)).toBe(200)
    expect(h.created).toEqual(['@deepseek-ai/dsh-x-ui/demo'])
  })

  it('guards the page and every mutating route it exposes', async () => {
    const h = await harness()
    for (const path of [
      '/dsh-x',
      '/dsh-x/api/state',
      '/dsh-x/api/terminal/read',
      '/dsh-x/api/terminal/open',
      '/dsh-x/api/terminal/send',
      '/dsh-x/api/terminal/close',
      '/dsh-x/api/schedule',
      '/dsh-x/api/schedule/delete',
      '/dsh-x/api/plugins/add',
      '/dsh-x/api/plugins/toggle',
      '/dsh-x/api/plugins/remove',
    ]) {
      expect((await fetch(`${h.origin}${path}`)).status, path).toBe(401)
    }
    expect(h.spawned).toBe(0)
  })

  it('refuses to spawn a PTY past the concurrency cap', async () => {
    const h = await harness()
    for (let index = 0; index < MAX_CONCURRENT_PTYS - 1; index += 1) {
      await h.terminals.spawn(h.agent, { type: 'shell', name: `seed-${index}` })
    }
    expect(await post(h.origin, '/dsh-x/api/terminal/open', { agentId: String(h.agent.id) }, TOKEN)).toBe(200)
    expect(h.spawned).toBe(MAX_CONCURRENT_PTYS)
    expect(await post(h.origin, '/dsh-x/api/terminal/open', { agentId: String(h.agent.id) }, TOKEN)).toBe(429)
    expect(h.spawned).toBe(MAX_CONCURRENT_PTYS)
  })

  it('refuses a request body past the cap with 413', async () => {
    const h = await harness()
    const response = await fetch(`${h.origin}/dsh-x/api/plugins/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(response.status).toBe(413)
    expect(h.created).toEqual([])
  })
})
