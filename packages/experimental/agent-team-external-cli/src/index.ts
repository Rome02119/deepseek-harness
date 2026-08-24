/** External CLI bridge for seating a one-shot CLI as an Agent Teams continuable teammate. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SendTeamMessageRequest } from '@deepseek-ai/dsh-experimental-agent-team'
import {
  type ContentBlock,
  type GenerateOptions,
  LlmAdapter,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertPositiveFinite,
  foldSubagentDescriptor,
  NO_START_CAPABILITIES,
  type ContinuableCreateSpec,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export const name = 'experimental-agent-team-external-cli'
export const inject = ['subagents', 'llm', 'subprocess', 'agentTeams']

const CLI_KINDS = ['agy', 'claude'] as const

type CliKind = typeof CLI_KINDS[number]

const DEFAULT_PROVIDER_NAME = 'agy-team'
const DEFAULT_LLM_PROVIDER = 'external-cli-team'
const DEFAULT_MODEL = 'agy'
const DEFAULT_COMMAND = 'agy'
const DEFAULT_CLI_KIND: CliKind = 'agy'
const DEFAULT_PERMISSION_MODE = 'dontAsk'
const DEFAULT_DISPOSE_GRACE_MS = 3_000
const DEFAULT_STDOUT_BYTES = 1_048_576
const DEFAULT_STDERR_BYTES = 65_536

/** Deployment-owned CLI route and process bounds. */
export interface Config {
  /** Provider name used on Agent Team roster entries. */
  readonly providerName?: string
  /** Internal LLM route installed only for bridged teammates. */
  readonly llmProvider?: string
  /** Model id recorded on bridged assistant messages. */
  readonly model?: string
  /** CLI executable path or PATH name. */
  readonly command?: string
  /** Invocation style for the target CLI. */
  readonly cliKind?: CliKind
  /** Claude Code unattended permission mode; ignored by `agy`. */
  readonly permissionMode?: string
  /** Explicit environment layered over the subprocess seam's scrubbed parent environment. */
  readonly env?: Record<string, string>
  /** Grace in milliseconds for subprocess tree termination. */
  readonly disposeGraceMs?: number
  /** Maximum collected stdout bytes retained as the teammate answer. */
  readonly stdoutMaxBytes?: number
  /** Maximum collected stderr bytes retained for failure diagnostics. */
  readonly stderrMaxBytes?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  llmProvider: z.string().min(1).default(DEFAULT_LLM_PROVIDER),
  model: z.string().min(1).default(DEFAULT_MODEL),
  command: z.string().min(1).default(DEFAULT_COMMAND),
  cliKind: z.union(CLI_KINDS).default(DEFAULT_CLI_KIND),
  permissionMode: z.string().min(1).default(DEFAULT_PERMISSION_MODE),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  stdoutMaxBytes: z.number().default(DEFAULT_STDOUT_BYTES),
  stderrMaxBytes: z.number().default(DEFAULT_STDERR_BYTES),
})

type ResolvedConfig = Required<Config>

interface BridgeSession {
  readonly id: SessionId
  readonly cwd: string
  readonly agent: Agent
}

interface CliResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

class ExternalCliProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = true

  constructor(readonly name: string) {}

  start(_request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    return Promise.reject(new Error(`external CLI provider "${this.name}" only supports continuable Agent Team teammates`))
  }

  prepareContinuable(): Promise<ContinuableCreateSpec> {
    return Promise.resolve({})
  }
}

class ExternalCliTeamBridge extends LlmAdapter {
  private readonly sessions = new Map<SessionId, BridgeSession>()
  private readonly running = new Set<SubprocessHandle>()

  constructor(
    private readonly config: ResolvedConfig,
    private readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
    private readonly sendTeamMessage: (agent: Agent, request: SendTeamMessageRequest) => Promise<unknown>,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'External CLI teammate' }
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'External CLI teammate' })
  }

  bind(session: BridgeSession): () => void {
    this.sessions.set(session.id, session)
    return () => {
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id)
    }
  }

  async dispose(): Promise<void> {
    const handles = [...this.running]
    for (const handle of handles) handle.terminate()
    await Promise.allSettled(handles.map(handle => handle.waitForExit()))
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId)
    if (session === undefined) {
      yield failed(`external CLI teammate has no active session binding for "${sessionId ?? '<missing>'}"`)
      return
    }
    const prompt = renderPrompt(options.messages)
    const result = await this.invoke(session, prompt, options.signal)
    if (!result.ok) {
      yield failed(cliFailure(result))
      return
    }
    const text = result.stdout.trim()
    if (text.length === 0) {
      yield failed('external CLI teammate produced no stdout')
      return
    }
    const target = replyTarget(options.messages)
    if (target !== undefined) {
      void this.sendReply(session.agent, target, text, options.signal).catch((error: unknown) => {
        session.agent.ctx.logger.warn(`external CLI teammate could not send a Team reply: ${errorMessage(error)}`)
      })
    }
    yield* textChunks(text)
  }

  private async sendReply(agent: Agent, target: string, text: string, signal?: AbortSignal): Promise<void> {
    await this.sendTeamMessage(agent, {
      target,
      content: [{ type: 'text', text }],
      delivery: 'quiet',
      signal: signal ?? NEVER_ABORT.signal,
    })
  }

  private async invoke(session: BridgeSession, prompt: string, signal?: AbortSignal): Promise<CliResult> {
    const handle = this.spawn({
      argv: cliArgv(this.config, prompt),
      cwd: session.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.config.stdoutMaxBytes },
        stderr: { maxBytes: this.config.stderrMaxBytes },
      },
      graceMs: this.config.disposeGraceMs,
      signal,
      env: this.config.env,
    })
    this.running.add(handle)
    try {
      const outcome = await handle.done
      await handle.waitForExit()
      return {
        ok: outcome.exitCode === 0 && outcome.signal === null,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
      }
    } finally {
      this.running.delete(handle)
    }
  }
}

function failed(message: string): StreamChunk {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { code: 'EXTERNAL_CLI_TEAMMATE_FAILED', message },
    },
  }
}

function cliFailure(result: CliResult): string {
  const fields = [
    `exit code: ${result.exitCode ?? '<none>'}`,
    `signal: ${result.signal ?? '<none>'}`,
  ]
  const stderr = result.stderr.trim()
  if (stderr.length > 0) fields.push(`stderr: ${stderr}`)
  return `external CLI teammate failed (${fields.join('; ')})`
}

function cliArgv(config: ResolvedConfig, prompt: string): string[] {
  switch (config.cliKind) {
    case 'agy':
      return [config.command, `-p=${prompt}`, '--output-format', 'text', '--dangerously-skip-permissions']
    case 'claude':
      return [config.command, '-p', '--output-format', 'text', '--permission-mode', config.permissionMode, prompt]
  }
}

function* textChunks(text: string): Iterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

function renderPrompt(messages: readonly Message[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === 'system') continue
    const rendered = renderContent(message.content)
    if (rendered.startsWith('Current runtime context.')) continue
    if (message.role === 'user') return stripTeamHeader(rendered)
  }
  return 'Reply with this teammate message.'
}

function renderContent(content: readonly ContentBlock[]): string {
  return content.map((block) => {
    switch (block.type) {
      case 'text':
        return block.text.replaceAll(/\s+/gu, ' ').trim()
      case 'reasoning':
        return `[reasoning] ${block.text}`
      case 'tool-call':
        return `[tool-call ${block.name} ${block.arguments}]`
      case 'tool-result':
        return `[tool-result ${block.toolCallId}] ${renderContent(block.content)}`
      case 'image':
        return '[image]'
      default:
        return `[${unknownBlockType(block)}]`
    }
  }).join(' / ')
}

function unknownBlockType(block: ContentBlock): string {
  const type = (block as { type?: unknown }).type
  return typeof type === 'string' ? type : 'content'
}

const TEAM_MESSAGE_HEADER = /Team message \S+ from ([^:]+):/u
const NEVER_ABORT = new AbortController()

function replyTarget(messages: readonly Message[]): string | undefined {
  let target: string | undefined
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const match = TEAM_MESSAGE_HEADER.exec(block.text)
      if (match !== null) target = match[1]
    }
  }
  return target
}

function stripTeamHeader(text: string): string {
  return text.replace(/^Team message \S+ from [^:]+:\s*(?:\/\s*)?/u, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolvedConfig(config: Config): ResolvedConfig {
  return {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    llmProvider: config.llmProvider ?? DEFAULT_LLM_PROVIDER,
    model: config.model ?? DEFAULT_MODEL,
    command: config.command ?? DEFAULT_COMMAND,
    cliKind: config.cliKind ?? DEFAULT_CLI_KIND,
    permissionMode: config.permissionMode ?? DEFAULT_PERMISSION_MODE,
    env: config.env as Record<string, string>,
    disposeGraceMs: config.disposeGraceMs as number,
    stdoutMaxBytes: config.stdoutMaxBytes as number,
    stderrMaxBytes: config.stderrMaxBytes as number,
  }
}

function assertBounds(config: ResolvedConfig): void {
  for (const name of ['disposeGraceMs', 'stdoutMaxBytes', 'stderrMaxBytes'] as const) {
    assertPositiveFinite('experimental-agent-team-external-cli', name, config[name])
  }
  if (config.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`experimental-agent-team-external-cli: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Register the external CLI Team bridge provider and child-scoped LLM route. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolvedConfig(config)
  assertBounds(resolved)
  const bridge = new ExternalCliTeamBridge(
    resolved,
    spec => ctx.subprocess.spawn(spec),
    (agent, request) => ctx.agentTeams.sendMessage(agent, request),
  )

  ctx.llm.registerAdapter([resolved.llmProvider], bridge)
  ctx.subagents.registerProvider(new ExternalCliProvider(resolved.providerName))
  ctx.subagents.registerContinuableSetup((childCtx) => {
    const agent = childCtx.agent as Agent
    const descriptor = foldSubagentDescriptor(agent.session.events.slice(agent.session.header.seedLength ?? 0))
    if (descriptor?.mode !== 'continuable' || descriptor.provider !== resolved.providerName) return () => {}
    const cwd = agent.session.header.cwd
    if (cwd === undefined) {
      throw new Error('external CLI teammate requires a parent Session cwd')
    }
    const unbind = bridge.bind({ id: agent.id, cwd, agent })
    const stopRequestRoute = childCtx.on('agent/request', ({ agent: subject }, next) =>
      subject === agent
        ? Promise.resolve({ provider: resolved.llmProvider, model: resolved.model })
        : next())
    return () => {
      stopRequestRoute()
      unbind()
    }
  })
  ctx.effect(() => async () => { await bridge.dispose() }, 'experimental-agent-team-external-cli.dispose()')
}
