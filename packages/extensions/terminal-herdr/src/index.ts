/** herdr-backed terminal provider for DSH-X. */

import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import type {
  TerminalBackend,
  TerminalBackendSession,
  TerminalBackendSpawnSpec,
  TerminalReadRequest,
  TerminalReadResult,
  TerminalSendOperation,
  TerminalSendRead,
  TerminalSendRequest,
  TerminalSendResult,
  TerminalSessionStatus,
  TerminalSignal,
  TerminalSignalResult,
} from '@deepseek-ai/dsh-terminal'
import z from '@deepseek-ai/schemastery'

/** Provider configuration. */
export interface Config {
  /** herdr executable path. */
  command: string
  /** Label used to find or create a workspace for this provider. */
  workspaceLabel: string
  /** Delay before reading output after a submitted command. */
  readDelayMs: number
}

type JsonRecord = Record<string, unknown>
type Runner = (args: readonly string[]) => string

/** Cordis plugin name. */
export const name = 'terminal-herdr'
/** Required terminal registry. */
export const inject = ['terminals']

/**
 * Locate a workspace with the exact configured label and cwd.
 * @param value - parsed JSON output from herdr workspace list.
 * @param cwd - working directory to match.
 * @param label - workspace label to match.
 * @returns matching workspace id or undefined.
 */
export function workspaceId(value: unknown, cwd: string, label: string): string | undefined {
  const result = record(value).result
  const workspaces = Array.isArray(record(result).workspaces) ? record(result).workspaces as unknown[] : []
  for (const workspace of workspaces) {
    const row = record(workspace)
    if (row.label === label && typeof row.workspace_id === 'string' && (row.cwd === undefined || row.cwd === cwd)) {
      return row.workspace_id
    }
  }
}

function rootPaneId(value: unknown): string {
  const paneId = record(record(record(value).result).root_pane).pane_id
  if (typeof paneId !== 'string' || paneId.length === 0) throw new Error('herdr response did not include result.root_pane.pane_id')
  return paneId
}

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}
}

function parseJson(stdout: string, args: readonly string[]): unknown {
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    throw new Error(`herdr returned non-JSON output for ${args.join(' ')}`)
  }
}

function isConnectionRefused(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /connection refused|econnrefused|failed to connect|no such file or directory.*herdr\.sock/i.test(message)
}

function commandError(error: NodeJS.ErrnoException, stdout: string, stderr: string, command: string): Error {
  if (error.code === 'ENOENT') return new Error(`herdr executable was not found at ${command}; install herdr or set terminal-herdr.command.`)
  return new Error((stderr || stdout || error.message).trim())
}

function cli(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, [...args], { encoding: 'utf8', maxBuffer: 8_000_000 })
  } catch (error: unknown) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    throw commandError(failure, failure.stdout ?? '', failure.stderr ?? '', command)
  }
}

/** One live herdr pane behind the terminal service. */
class HerdrTerminalSession implements TerminalBackendSession {
  readonly motd = ''
  private closed = false

  constructor(
    private readonly paneId: string,
    private readonly run: Runner,
    private readonly readDelayMs: number,
  ) {}

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    request.signal?.throwIfAborted()
    if (this.closed) throw new Error('herdr pane is closed')
    let consumed = false
    const done = (async (): Promise<TerminalSendResult> => {
      this.run(['pane', 'send-text', this.paneId, request.text])
      if (request.submit) this.run(['pane', 'send-keys', this.paneId, 'Enter'])
      if (this.readDelayMs > 0) await delay(this.readDelayMs, undefined, { signal: request.signal })
      const viewport = this.run(['pane', 'read', this.paneId])
      return { viewport, waitReason: 'stdin_read', sessionStatus: this.status(), truncated: false }
    })()
    return {
      done,
      readOutput: (): TerminalSendRead => {
        if (consumed) return { delta: '', truncated: false }
        consumed = true
        return { delta: '', truncated: false }
      },
      cancel: () => false,
    }
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    return page(this.run(['pane', 'read', this.paneId]), request)
  }

  signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    return Promise.resolve().then(() => {
      if (signal !== 'SIGINT') throw new Error(`herdr does not support ${signal} for pane input`)
      this.run(['pane', 'send-keys', this.paneId, 'Ctrl-C'])
      return { delivered: true, targetPgid: 0 }
    })
  }

  status(): TerminalSessionStatus { return this.closed ? { kind: 'exited', exitCode: null, signal: null } : { kind: 'running' } }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.run(['pane', 'close', this.paneId])
    this.closed = true
    return Promise.resolve()
  }
}

function page(text: string, request: TerminalReadRequest): TerminalReadResult {
  const lines = text.split('\n')
  const count = request.count ?? lines.length
  const offset = request.offset ?? 0
  const end = Math.max(0, lines.length - offset)
  const begin = Math.max(0, end - count)
  return { text: lines.slice(begin, end).join('\n'), totalLines: lines.length, lineBegin: lines.length - end, lineEnd: lines.length - begin, truncated: begin > 0 }
}

/** Backend which delegates each pane operation to the herdr CLI argv API. */
export class HerdrTerminalBackend implements TerminalBackend {
  readonly type = 'herdr'
  private serverStarted = false
  private readonly rawRun: Runner

  constructor(
    private readonly config: Config,
    runner?: Runner,
  ) {
    this.rawRun = runner ?? (args => cli(this.config.command, args))
  }

  private run(args: readonly string[]): string {
    return this.invoke(args)
  }

  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    return Promise.resolve().then(() => {
      const cwd = spec.cwd ?? process.cwd()
      const workspaces = parseJson(this.run(['workspace', 'list']), ['workspace', 'list'])
      let workspace = workspaceId(workspaces, cwd, this.config.workspaceLabel)
      if (workspace === undefined) {
        workspace = rootPaneId(parseJson(this.run([
          'workspace', 'create', '--cwd', cwd, '--label', this.config.workspaceLabel,
        ]), ['workspace', 'create'])).split(':')[0]
        if (workspace === undefined) throw new Error('herdr workspace pane id did not include a workspace id')
      }
      const pane = rootPaneId(parseJson(this.run([
        'tab', 'create', '--workspace', workspace, '--cwd', cwd,
        ...spec.name === undefined ? [] : ['--label', spec.name],
      ]), ['tab', 'create']))
      return new HerdrTerminalSession(pane, args => this.run(args), this.config.readDelayMs)
    })
  }

  private invoke(args: readonly string[]): string {
    try {
      return this.rawRun(args)
    } catch (error) {
      if (!isConnectionRefused(error)) throw error
      this.startServer()
      let lastError: unknown = error
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          if (attempt > 0) {
            const buffer = new Int32Array(new SharedArrayBuffer(4))
            Atomics.wait(buffer, 0, 0, 100)
          }
          return this.rawRun(args)
        } catch (retryError) {
          lastError = retryError
          if (!isConnectionRefused(retryError)) throw retryError
        }
      }
      throw lastError
    }
  }

  private startServer(): void {
    if (this.serverStarted) return
    this.serverStarted = true
    try {
      const child = spawn(this.config.command, ['server'], { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (error: unknown) {
      const failure = error as NodeJS.ErrnoException
      throw commandError(failure, '', '', this.config.command)
    }
  }
}

/** Register the herdr terminal backend. */
export function apply(ctx: Context, config: Config): void {
  ctx.terminals.registerBackend(new HerdrTerminalBackend(config))
}

/** Provider configuration schema. */
export const Config: z<Config> = z.object({
  command: z.string().default('/opt/homebrew/bin/herdr'),
  workspaceLabel: z.string().default('DSH-X'),
  readDelayMs: z.number().step(1).min(0).default(250),
})
