/** Shared token authentication for DSH-X HTTP routes. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TOKEN_DIR = join(homedir(), '.dsh-x')
const TOKEN_FILE = join(TOKEN_DIR, 'token')
const COOKIE = 'dsh_x_token='

/** Maximum accepted HTTP request-body bytes for DSH-X routes. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024

/** One DSH-X route handler, owning the full response lifecycle. */
export type DshXHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/**
 * Wrap one route handler with the DSH-X authentication check.
 * Resolving the token here materialises `~/.dsh-x/token` at route registration, which is DSH-X boot.
 * @param handler Runs only for an authorized request; an unauthorized request is answered by the guard.
 * @returns A handler answering 401 (or a cookie-setting redirect) instead of delegating when unauthorized.
 */
export function dshXAuth(handler: DshXHandler): DshXHandler {
  // Route registration is DSH-X boot, and the token file has to exist by then:
  // it is the only place the tokenised link can be read from.
  dshXToken()
  return (req, res) => {
    if (requireDshXAuth(req, res)) return handler(req, res)
  }
}

/**
 * Authorize a loopback peer, or a request carrying the configured DSH-X token.
 *
 * Loopback is decided from the socket peer address alone: `X-Forwarded-For` and every other
 * client-supplied header is untrusted here, because a tailnet peer can set them freely.
 * A token arriving as a `?token=` query parameter on a GET is converted to an HttpOnly cookie
 * by a redirect to the same path without the parameter, so the token leaves the URL bar after
 * one visit. That redirect is reported as unauthorized to the caller so the wrapped handler
 * does not also write to the response.
 * @param req Incoming request; its socket peer address and `authorization`/`cookie` headers are read.
 * @param res Response written only when the request is refused or redirected.
 * @returns `true` when the wrapped handler may run.
 */
export function requireDshXAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopback(req.socket.remoteAddress)) return true
  const url = new URL(req.url ?? '/', 'http://dsh-x.invalid')
  const queryToken = url.searchParams.get('token')
  const presented = bearerToken(req.headers.authorization) ?? cookieToken(req.headers.cookie) ?? queryToken
  if (!matchesToken(presented)) {
    res.writeHead(401, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>DSH-X</title><p>Open the tokenised DSH-X link to sign in.</p>')
    return false
  }
  if (queryToken !== null && req.method === 'GET') {
    url.searchParams.delete('token')
    res.writeHead(302, {
      'cache-control': 'no-store',
      location: `${url.pathname}${url.search}${url.hash}`,
      'set-cookie': `${COOKIE}${encodeURIComponent(queryToken)}; HttpOnly; SameSite=Lax; Path=/`,
    })
    res.end()
    return false
  }
  return true
}

/**
 * Read an HTTP request body, refusing one larger than {@link MAX_REQUEST_BODY_BYTES}.
 * @param req Incoming request consumed as a stream; paused as soon as the cap is passed, leaving the caller to answer 413.
 * @returns The complete body bytes.
 * @throws DshXBodyTooLargeError once the received bytes exceed the cap.
 */
export async function readDshXBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    bytes += buffer.length
    if (bytes > MAX_REQUEST_BODY_BYTES) {
      // Pause rather than destroy: the socket must survive long enough for the
      // route to write its 413, and Node closes it once that response ends.
      req.pause()
      throw new DshXBodyTooLargeError()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Thrown by {@link readDshXBody}; DSH-X routes map it to HTTP 413. */
export class DshXBodyTooLargeError extends Error {
  constructor() {
    super('request body too large')
  }
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function bearerToken(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value
  return /^Bearer (.+)$/.exec(header ?? '')?.[1]
}

function cookieToken(cookie: string | undefined): string | undefined {
  const part = cookie?.split(';').map(entry => entry.trim()).find(entry => entry.startsWith(COOKIE))
  return part === undefined ? undefined : decodeURIComponent(part.slice(COOKIE.length))
}

function matchesToken(presented: string | null | undefined): boolean {
  if (presented === undefined || presented === null) return false
  const expected = Buffer.from(dshXToken())
  const actual = Buffer.from(presented)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

let cached: string | undefined

/** The token an environment override supplies, otherwise the one persisted under the user's home directory. */
function dshXToken(): string {
  const override = process.env.DSH_X_TOKEN
  if (override !== undefined && override.length > 0) return override
  if (cached !== undefined) return cached
  cached = readTokenFile() ?? createTokenFile()
  return cached
}

function readTokenFile(): string | undefined {
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

function createTokenFile(): string {
  mkdirSync(TOKEN_DIR, { mode: 0o700, recursive: true })
  const token = randomBytes(32).toString('hex')
  try {
    writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return token
  } catch (error) {
    // A concurrent DSH-X process won the create race; its token is the shared one.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readFileSync(TOKEN_FILE, 'utf8').trim()
  }
}
