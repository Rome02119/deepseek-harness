import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { LlmModelDiscoveryRequest, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { OmniRouteAdapter, readModels } from './adapter.ts'
import type { OmniRouteConnectionOptions, OmniRouteModel } from './adapter.ts'

export { OmniRouteAdapter, readModels } from './adapter.ts'
export type { OmniRouteAdapterOptions, OmniRouteConnectionOptions, OmniRouteModel } from './adapter.ts'

export const name = 'llm-omniroute'
export const inject = ['llm']

const NS = settingsNamespace('llm-omniroute')
const DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1'
const DEFAULT_PROVIDER = 'omniroute'
const DEFAULT_DISPLAY_NAME = 'OmniRoute'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/** Runtime configuration for the OmniRoute LLM adapter plugin. */
export interface Config {
  /** Registered provider route; defaults to `omniroute`. */
  provider?: string
  /** Display name for selectors and the Models page. */
  displayName?: string
  /** OpenAI-compatible `/v1` endpoint; defaults to local OmniRoute. */
  baseURL?: string
  /** Optional credential reference; omitted sends no Authorization header. */
  apiKeyEnv?: string
  /** Catalog request timeout; default ten seconds. */
  catalogTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  retryPolicy?: RetryPolicyConfig
}

export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  apiKeyEnv: z.string().role('credential-ref'),
  catalogTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

function resolveOptions(config: Config): OmniRouteConnectionOptions & { catalogTimeoutMs: number } {
  const provider = config.provider ?? DEFAULT_PROVIDER
  if (provider.length === 0) throw new Error('llm-omniroute: provider must be non-empty')
  const displayName = config.displayName ?? DEFAULT_DISPLAY_NAME
  if (displayName.length === 0) throw new Error('llm-omniroute: displayName must be non-empty')
  const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  if (baseURL.length === 0) throw new Error('llm-omniroute: baseURL must be non-empty')
  const catalogTimeoutMs = config.catalogTimeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(catalogTimeoutMs) || catalogTimeoutMs <= 0 || catalogTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-omniroute: catalogTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`llm-omniroute: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return {
    provider,
    displayName,
    baseURL,
    ...config.apiKeyEnv === undefined ? {} : { apiKey: credentialRef(config.apiKeyEnv) },
    catalogTimeoutMs,
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-omniroute: retryPolicy'),
  }
}

function signalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

async function fetchModels(
  connection: OmniRouteConnectionOptions & { catalogTimeoutMs: number },
  signal?: AbortSignal,
): Promise<readonly OmniRouteModel[]> {
  const url = `${connection.baseURL}/models`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...connection.apiKey === undefined ? {} : { authorization: `Bearer ${connection.apiKey}` },
      },
      signal: signalWithTimeout(signal, connection.catalogTimeoutMs),
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw new LlmError('OmniRoute model discovery aborted by caller', 'ABORTED', { cause: error })
    throw new LlmError(`OmniRoute is not reachable at ${url}; start OmniRoute before using provider route "${connection.provider}"`, 'CATALOG_UNAVAILABLE', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(`OmniRoute model listing at ${url} answered HTTP ${response.status}`, 'CATALOG_UNAVAILABLE', { status: response.status })
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error: unknown) {
    throw new LlmError(`OmniRoute model listing at ${url} did not answer with JSON`, 'CATALOG_UNAVAILABLE', { cause: error })
  }
  return readModels(body)
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ReturnType<typeof resolveOptions> | undefined
  const options = (): ReturnType<typeof resolveOptions> => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    const resolved = resolveOptions(raw)
    lastRaw = raw
    lastGood = resolved
    return resolved
  }
  options()

  let catalog: { key: string; models: readonly OmniRouteModel[] } | undefined
  const resolveApiKey = async (connection: ReturnType<typeof resolveOptions>): Promise<typeof connection> => {
    if (connection.apiKey === undefined) return connection
    const ref = connection.apiKey
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(credentialRef(ref)))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit === undefined || hit.length === 0) {
      throw new LlmError(
        `llm-omniroute: no credential for provider route "${connection.provider}"; unset apiKeyEnv for local no-key OmniRoute or store ${ref}`,
        'MISSING_CREDENTIAL',
      )
    }
    return { ...connection, apiKey: assertUsableApiKey(hit, 'llm-omniroute', credentialRef(ref)) }
  }
  const models = async (signal?: AbortSignal): Promise<readonly OmniRouteModel[]> => {
    const connection = await resolveApiKey(options())
    const key = `${connection.baseURL}\0${connection.apiKey ?? ''}`
    if (catalog?.key === key) return catalog.models
    const live = await fetchModels(connection, signal)
    catalog = { key, models: live }
    return live
  }

  const adapter = new OmniRouteAdapter({
    options,
    connection: () => resolveApiKey(options()),
    models,
    resolveAttachments: () => ctx.get('attachments'),
  })
  const registration = ctx.llm.registerAdapter([options().provider], adapter)
  const directory = ctx.llm.registerConfigurableProviders([
    { provider: options().provider, displayName: options().displayName, settingsNs: NS, settingsPath: [] },
  ])
  ctx.llm.registerModelDiscovery(NS, (request: LlmModelDiscoveryRequest) => {
    const connection = {
      ...options(),
      ...request.baseURL === undefined ? {} : { baseURL: request.baseURL.replace(/\/+$/, '') },
      ...request.apiKey === undefined ? {} : { apiKey: assertUsableApiKey(request.apiKey, 'llm-omniroute', credentialRef('probe')) },
    }
    return fetchModels(connection, request.signal)
  })

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {
      catalog = undefined
      registration.replace([options().provider])
      directory.replace([
        { provider: options().provider, displayName: options().displayName, settingsNs: NS, settingsPath: [] },
      ])
    },
  })
}
