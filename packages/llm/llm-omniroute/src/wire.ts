import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { contentHasImage, LlmError, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, ImageRequestPolicy, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'

/** One model entry from OmniRoute's OpenAI-compatible model listing. */
export interface OmniRouteWireModel {
  id?: unknown
  name?: unknown
  owned_by?: unknown
  context_length?: unknown
  max_output_tokens?: unknown
  capabilities?: unknown
  input_modalities?: unknown
}

/** Capability fields OmniRoute reports for a model. */
export interface OmniRouteCapabilities {
  toolCalling?: boolean
  reasoning?: boolean
  thinking?: boolean
  vision?: boolean
  effortTiers?: readonly string[]
}

/** Validated OmniRoute model metadata. */
export interface OmniRouteModel {
  id: string
  name: string
  owner?: string
  contextWindow?: number
  maxTokens?: number
  capabilities: OmniRouteCapabilities
}

/** OpenAI-compatible error response body returned by OmniRoute. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}

/** Token usage fields emitted by OmniRoute streaming chunks. */
export interface WireUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** OpenAI-compatible streaming chunk emitted by OmniRoute. */
export interface WireChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: WireUsage | null
}

type WireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | WireContentPart[] }
  | { role: 'assistant'; content: string | null; reasoning_content?: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface ImageSerialization {
  requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function effortTiers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tiers = value.filter((tier): tier is string => typeof tier === 'string' && tier.length > 0)
  return tiers.length === 0 ? undefined : tiers
}

/**
 * Validate the OmniRoute model listing entries the adapter can expose.
 *
 * @param body Raw JSON body from `GET /v1/models`.
 * @returns Deduplicated model metadata usable by the DSH model catalog.
 */
export function readModels(body: unknown): OmniRouteModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new LlmError('OmniRoute model listing has no "data" array', 'CATALOG_UNAVAILABLE')
  const seen = new Set<string>()
  const models: OmniRouteModel[] = []
  for (const raw of data) {
    const entry = raw as OmniRouteWireModel | null
    const id = stringField(entry?.id)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const capabilities = (entry?.capabilities as Record<string, unknown> | null) ?? {}
    const toolCalling = booleanField(capabilities.tool_calling)
    const reasoning = booleanField(capabilities.reasoning)
    const thinking = booleanField(capabilities.thinking)
    const vision = booleanField(capabilities.vision)
    const tiers = effortTiers(capabilities.effort_tiers)
    const name = stringField(entry?.name) ?? id
    const owner = stringField(entry?.owned_by)
    const contextWindow = positiveInteger(entry?.context_length)
    const maxTokens = positiveInteger(entry?.max_output_tokens)
    models.push({
      id,
      name,
      ...owner === undefined ? {} : { owner },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      capabilities: {
        ...toolCalling === undefined ? {} : { toolCalling },
        ...reasoning === undefined ? {} : { reasoning },
        ...thinking === undefined ? {} : { thinking },
        ...vision === undefined ? {} : { vision },
        ...tiers === undefined ? {} : { effortTiers: tiers },
      },
    })
  }
  return models
}

function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function reasoningText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
}

function toolCalls(blocks: readonly ContentBlock[]): WireToolCall[] {
  return blocks
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: String(block.id),
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
}

function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    switch (block.type) {
      case 'text': return block.text
      case 'tool-result': return toolResultText(block.content)
      default: return ''
    }
  }).join('')
}

async function userParts(
  blocks: readonly ContentBlock[],
  images: ImageSerialization,
): Promise<WireContentPart[]> {
  const parts: WireContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image': {
        const version = images.requestImages.get(block.attachment.attachmentId)
        if (version === undefined) throw new LlmError(`OmniRoute request image ${block.attachment.attachmentId} was not prepared`, 'INVALID_REQUEST')
        if (parts.length > 0) parts.push({ type: 'text', text: '\n' })
        parts.push(
          { type: 'text', text: requestImageHandleText(version) },
          { type: 'image_url', image_url: { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` } },
        )
        break
      }
      case 'tool-result':
        parts.push(...await userParts(block.content, images))
        break
      default:
        break
    }
  }
  return parts
}

async function wireMessage(message: Message, images: ImageSerialization | undefined): Promise<WireMessage[]> {
  if (message.source.kind === 'tool') {
    return [{ role: 'tool', tool_call_id: String(message.source.callId), content: toolResultText(message.content) || '(no output)' }]
  }
  switch (message.role) {
    case 'system':
      return [{ role: 'system', content: flattenText(message.content) }]
    case 'user':
      if (images !== undefined && contentHasImage(message.content)) {
        const parts = await userParts(message.content, images)
        return [{ role: 'user', content: parts.length === 0 ? '(no input)' : parts }]
      }
      return [{ role: 'user', content: flattenText(message.content) || '(no input)' }]
    case 'assistant': {
      const calls = toolCalls(message.content)
      const content = flattenText(message.content)
      const reasoning = reasoningText(message.content)
      return [{
        role: 'assistant',
        content: content.length > 0 ? content : calls.length > 0 ? '' : null,
        ...reasoning.length === 0 ? {} : { reasoning_content: reasoning },
        ...calls.length === 0 ? {} : { tool_calls: calls },
      }]
    }
  }
}

/**
 * Collect durable image refs from the already modality-projected request.
 *
 * @param messages Model request messages.
 * @returns Unique image attachment refs in request order.
 */
export function collectImageRefs(messages: readonly Message[]): ImageAttachmentRef[] {
  const refs = new Map<ImageAttachmentRef['attachmentId'], ImageAttachmentRef>()
  const visit = (blocks: readonly ContentBlock[]): void => {
    for (const block of blocks) {
      if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
      else if (block.type === 'tool-result') visit(block.content)
    }
  }
  for (const message of messages) visit(message.content)
  return [...refs.values()]
}

/**
 * Serialize a DSH generation request into OmniRoute's OpenAI-compatible request body.
 *
 * @param options DSH generation request.
 * @param images Prepared image data when the request still contains image blocks.
 * @returns JSON request body for `/v1/chat/completions`.
 */
export async function serializeRequest(
  options: GenerateOptions,
  images: ImageSerialization | undefined,
): Promise<Record<string, unknown>> {
  const messages: WireMessage[] = []
  if (options.system !== undefined && options.system.length > 0) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) messages.push(...await wireMessage(message, images))
  const tools = (options.tools ?? []).map((tool: ToolSchema) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools.length === 0 ? {} : { tools },
    ...options.temperature === undefined ? {} : { temperature: options.temperature },
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop === undefined ? {} : { stop: options.stop },
    ...options.reasoningEffort === undefined || options.reasoningEffort === 'none'
      ? {}
      : { reasoning_effort: String(options.reasoningEffort) },
  }
}

/** Limits for converting DSH image attachments into OpenAI-compatible data URLs. */
export const REQUEST_IMAGE_POLICY: ImageRequestPolicy = {
  maxPixels: 640_000,
  maxBytes: 1024 * 1024,
}
