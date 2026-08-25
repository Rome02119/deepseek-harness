import { EventSourceParserStream } from 'eventsource-parser/stream'
import {
  attributionHeaders,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId,
  CallId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ResolvedRetryPolicy,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { collectImageRefs, readModels, REQUEST_IMAGE_POLICY, serializeRequest } from './wire.ts'
import type { OmniRouteModel, WireChunk, WireError, WireUsage } from './wire.ts'

const DONE = '[DONE]'
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'

/** Resolved connection settings for OmniRoute requests. */
export interface OmniRouteConnectionOptions {
  /** OpenAI-compatible `/v1` endpoint. */
  baseURL: string
  /** Provider route registered in DSH. */
  provider: string
  /** Human-readable route name. */
  displayName: string
  /** Optional credential reference; omitted means no Authorization header. */
  apiKey?: string
  /** Maximum idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

/** Dependencies supplied by the plugin host to the OmniRoute adapter. */
export interface OmniRouteAdapterOptions {
  /** Current validated connection facts. */
  options: () => OmniRouteConnectionOptions
  /** Current connection facts with any configured credential resolved. */
  connection: () => Promise<OmniRouteConnectionOptions>
  /** Live OmniRoute catalog lookup. */
  models: (signal?: AbortSignal) => Promise<readonly OmniRouteModel[]>
  /** Resolve optional image storage. */
  resolveAttachments?: () => AttachmentStore | undefined
}

function finishReason(reason: string): StreamChunk & { type: 'finish' } {
  switch (reason) {
    case 'stop': return { type: 'finish', reason: { kind: 'stop' } }
    case 'tool_calls': return { type: 'finish', reason: { kind: 'tool-calls' } }
    case 'length': return { type: 'finish', reason: { kind: 'max-tokens' } }
    default:
      return {
        type: 'finish',
        reason: { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } },
      }
  }
}

function usageOf(usage: WireUsage): TokenUsage | undefined {
  if (typeof usage.prompt_tokens !== 'number' || typeof usage.completion_tokens !== 'number') return undefined
  const cacheRead = usage.prompt_tokens_details?.cached_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...reasoning === undefined ? {} : { reasoningTokens: reasoning },
  }
}

async function* ssePayloads(stream: ReadableStream<BufferSource>): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
  for await (const { data } of events) {
    yield data
    if (data === DONE) return
  }
  throw new LlmError('OmniRoute SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let next = 0
  let text: { index: number; value: string } | undefined
  let reasoning: { index: number; value: string } | undefined
  const tools = new Map<number, { index: number; id: string; name?: string; arguments: string }>()
  let pendingFinish: StreamChunk & { type: 'finish' } | undefined
  let pendingUsage: TokenUsage | undefined

  for await (const payload of payloads) {
    if (payload === DONE) {
      if (reasoning !== undefined) yield { type: 'block-end', index: reasoning.index, block: { type: 'reasoning', text: reasoning.value } }
      if (text !== undefined) yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.value } }
      for (const tool of tools.values()) {
        yield {
          type: 'block-end',
          index: tool.index,
          block: { type: 'tool-call', id: CallId(tool.id), name: tool.name ?? '', arguments: tool.arguments },
        }
      }
      if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
      if (pendingFinish === undefined || (pendingFinish.reason.kind === 'stop' && reasoning === undefined && text === undefined && tools.size === 0)) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'OmniRoute returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          },
        }
      } else {
        yield pendingFinish
      }
      return
    }
    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch {
      throw new LlmError(`malformed OmniRoute SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        if (reasoning === undefined) {
          reasoning = { index: next++, value: '' }
          yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
        }
        reasoning.value += delta.reasoning_content
        yield { type: 'reasoning-delta', index: reasoning.index, text: delta.reasoning_content }
      }
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        if (text === undefined) {
          text = { index: next++, value: '' }
          yield { type: 'block-start', index: text.index, blockType: 'text' }
        }
        text.value += delta.content
        yield { type: 'text-delta', index: text.index, text: delta.content }
      }
      for (const call of delta?.tool_calls ?? []) {
        let tool = tools.get(call.index)
        if (tool === undefined) {
          tool = { index: next++, id: '', arguments: '' }
          tools.set(call.index, tool)
          yield { type: 'block-start', index: tool.index, blockType: 'tool-call' }
        }
        if (call.id !== undefined) tool.id = call.id
        if (call.function?.name !== undefined) tool.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        tool.arguments += fragment
        yield {
          type: 'tool-call-delta',
          index: tool.index,
          id: CallId(tool.id),
          ...tool.name === undefined ? {} : { name: tool.name },
          argumentsDelta: fragment,
        }
      }
      if (typeof choice.finish_reason === 'string') pendingFinish = finishReason(choice.finish_reason)
    }
    if (chunk.usage !== undefined && chunk.usage !== null) pendingUsage = usageOf(chunk.usage)
  }
  throw new LlmError('OmniRoute SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}

function codeFor(status: number, error?: WireError['error']): string {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) return isContextWindowExceededError(detail) ? CONTEXT_WINDOW_EXCEEDED_CODE : 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1_000
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

function modelInfo(provider: string, model: OmniRouteModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name,
    ...model.owner === undefined ? {} : { description: model.owner },
    inputModalities: model.capabilities.vision === true ? ['text', 'image'] : ['text'],
  }
}

function effortName(effort: string): string {
  return effort === 'xhigh'
    ? 'Xhigh'
    : `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

function resolvedInfo(provider: string, model: OmniRouteModel): LlmResolvedModelInfo {
  const efforts = model.capabilities.effortTiers
  return {
    ...modelInfo(provider, model),
    ...model.contextWindow === undefined ? {} : { context: { contextWindow: model.contextWindow } },
    ...model.maxTokens === undefined ? {} : { defaultMaxTokens: model.maxTokens },
    ...efforts === undefined || efforts.length === 0 ? {} : {
      reasoning: {
        efforts: efforts.map(effort => ({ id: ReasoningEffortId(effort), name: effortName(effort) })),
      },
    },
  }
}

/** OpenAI-compatible OmniRoute adapter backed by its live `/models` endpoint. */
export class OmniRouteAdapter extends LlmAdapter {
  constructor(private readonly config: OmniRouteAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.config.options().displayName }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.config.models()).map(model => modelInfo(provider, model))
  }

  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const found = (await this.config.models(signal)).find(entry => entry.id === model)
    if (found === undefined) throw new LlmError(`OmniRoute model "${model}" is not in the live catalog`, 'UNKNOWN_MODEL')
    return resolvedInfo(provider, found)
  }

  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = await this.config.connection()
    const found = (await this.config.models(signal)).find(entry => entry.id === model)
    if (found === undefined) throw new LlmError(`OmniRoute model "${model}" is not in the live catalog`, 'UNKNOWN_MODEL')
    return {
      model: resolvedInfo(provider, found),
      stream: options => this.streamWithConnection(options, connection, found),
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamResolved(options)
  }

  private async * streamResolved(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* this.streamWithConnection(options, await this.config.connection())
  }

  private async * streamWithConnection(
    options: GenerateOptions,
    connection: OmniRouteConnectionOptions,
    catalogModel?: OmniRouteModel,
  ): AsyncIterable<StreamChunk> {
    const model = catalogModel ?? (await this.config.models(options.signal)).find(entry => entry.id === options.model)
    if (model === undefined) throw new LlmError(`OmniRoute model "${options.model}" is not in the live catalog`, 'UNKNOWN_MODEL')
    if ((options.tools?.length ?? 0) > 0 && model.capabilities.toolCalling !== true) {
      throw new LlmError(`OmniRoute model "${options.model}" does not report tool_calling support`, 'UNSUPPORTED_OPTION')
    }
    if (options.reasoningEffort !== undefined && model.capabilities.effortTiers?.includes(String(options.reasoningEffort)) !== true) {
      throw new LlmError(`OmniRoute model "${options.model}" does not report reasoning effort "${options.reasoningEffort}"`, 'UNSUPPORTED_REASONING_EFFORT')
    }
    const refs = collectImageRefs(options.messages)
    const attachments = refs.length === 0 ? undefined : this.config.resolveAttachments?.()
    if (refs.length > 0 && attachments === undefined) {
      throw new LlmError('OmniRoute image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    const versions = new Map<ImageAttachmentRef['attachmentId'], RequestImageAttachment>()
    if (attachments !== undefined) {
      for (const ref of refs) {
        versions.set(ref.attachmentId, await attachments.readImageRequest(ref, REQUEST_IMAGE_POLICY, options.signal))
      }
    }

    const consumer = new AbortController()
    const upstream = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(options, connection, versions, watchdog.signal)[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(`OmniRoute stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) throw new LlmError('OmniRoute request aborted by caller', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError(`OmniRoute API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('OmniRoute stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) await iterator.return().catch(() => undefined)
    }
  }

  private async * request(
    options: GenerateOptions,
    connection: OmniRouteConnectionOptions,
    requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>,
    signal: AbortSignal,
  ): AsyncIterable<StreamChunk> {
    let response: Response
    try {
      response = await fetch(`${connection.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...connection.apiKey === undefined ? {} : { authorization: `Bearer ${connection.apiKey}` },
          ...attributionHeaders(),
        },
        body: JSON.stringify(await serializeRequest(options, requestImages.size === 0 ? undefined : { requestImages })),
        signal,
      })
    } catch (error: unknown) {
      if (signal.aborted) throw error
      throw new LlmError(`OmniRoute API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      const raw = await response.text()
      let providerError: WireError['error']
      try {
        providerError = (JSON.parse(raw) as WireError).error
      } catch {
        providerError = undefined
      }
      const delay = retryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(providerError?.message ?? `OmniRoute API error (HTTP ${response.status})`, codeFor(response.status, providerError), {
        cause: new Error(raw.length > 0 ? raw : `OmniRoute HTTP ${response.status}`),
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }
    if (response.body === null) throw new LlmError('OmniRoute API returned no response body', 'EMPTY_RESPONSE')
    yield* translate(ssePayloads(response.body))
  }
}

export { readModels }
export type { OmniRouteModel }
