import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  DshXBodyTooLargeError,
  dshXAuth,
  MAX_REQUEST_BODY_BYTES,
  readDshXBody,
} from '../src/index.ts'

const TOKEN = 'a'.repeat(64)

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  delete process.env.DSH_X_TOKEN
  for (const close of closers.splice(0)) await close()
})

/**
 * Serve one guarded handler over real HTTP while presenting a fixed socket peer
 * address, so a tailnet peer can be exercised without a second interface.
 */
async function serve(peer: string): Promise<{ origin: string; calls: string[] }> {
  const calls: string[] = []
  const guarded = dshXAuth((req, res) => {
    calls.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('reached')
  })
  const server = createServer((req, res) => { void guarded(req, res) })
  server.on('connection', (socket) => {
    Object.defineProperty(socket, 'remoteAddress', { value: peer, configurable: true })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  closers.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls }
}

describe('dshXAuth over HTTP', () => {
  it('refuses a tailnet peer that presents no token, without reaching the handler', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    const response = await fetch(`${origin}/dsh-x/api/plugins/add`, { method: 'POST', body: '{"name":"evil"}' })
    expect(response.status).toBe(401)
    const body = await response.text()
    expect(body).toContain('tokenised DSH-X link')
    expect(body).not.toContain(TOKEN)
    expect([...response.headers.keys()]).not.toContain('set-cookie')
    expect(calls).toEqual([])
  })

  it('refuses an equal-length wrong token and a wrong-length token alike', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    for (const presented of ['b'.repeat(64), 'a'.repeat(63), '']) {
      const response = await fetch(`${origin}/dsh-x`, { headers: { authorization: `Bearer ${presented}` } })
      expect(response.status, presented.length.toString()).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('admits a loopback peer with no token at all', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('127.0.0.1')
    expect((await fetch(`${origin}/dsh-x`)).status).toBe(200)
    expect(calls).toEqual(['/dsh-x'])
  })

  it('ignores a forged X-Forwarded-For claiming loopback', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    const response = await fetch(`${origin}/dsh-x`, { headers: { 'x-forwarded-for': '127.0.0.1' } })
    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('admits a tailnet peer presenting the token as a bearer header or a cookie', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    expect((await fetch(`${origin}/dsh-x`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200)
    expect((await fetch(`${origin}/dsh-x`, { headers: { cookie: `dsh_x_token=${TOKEN}` } })).status).toBe(200)
    expect(calls).toEqual(['/dsh-x', '/dsh-x'])
  })

  it('converts a query token on GET into an HttpOnly cookie and drops it from the path', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    const response = await fetch(`${origin}/dsh-x?token=${TOKEN}&tab=plugins`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/dsh-x?tab=plugins')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(calls).toEqual([])
  })

  it('accepts a query token on a non-GET request without redirecting', async () => {
    process.env.DSH_X_TOKEN = TOKEN
    const { origin, calls } = await serve('100.64.0.5')
    const response = await fetch(`${origin}/dsh-x/api/state?token=${TOKEN}`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})

describe('readDshXBody', () => {
  it('returns a body inside the cap and refuses one past it', async () => {
    const seen: Array<number | string> = []
    const server = createServer((req, res) => {
      void readDshXBody(req).then(
        (body) => { seen.push(body.length) },
        (error: unknown) => { seen.push(error instanceof DshXBodyTooLargeError ? 'too-large' : 'other') },
      ).then(() => { res.writeHead(200); res.end() })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    closers.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await fetch(origin, { method: 'POST', body: 'x'.repeat(1024) })
    await fetch(origin, { method: 'POST', body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) }).catch(() => undefined)
    expect(seen[0]).toBe(1024)
    expect(seen[1]).toBe('too-large')
  })
})
