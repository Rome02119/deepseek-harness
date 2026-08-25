import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as OmniRoute from '../src/index.ts'

let server: ReturnType<typeof createServer> | undefined

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server === undefined) {
      resolve()
      return
    }
    server.close(() => {
      server = undefined
      resolve()
    })
  })
}

afterEach(async () => {
  await closeServer()
})

async function mockOmniRoute(): Promise<{ url: string; requests: unknown[] }> {
  const requests: unknown[] = []
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        object: 'list',
        data: [
          {
            id: 'auto/cheap',
            name: 'Cheap',
            owned_by: 'combo',
            context_length: 1048576,
            max_output_tokens: 512000,
            capabilities: { tool_calling: true, reasoning: true, effort_tiers: ['none', 'low'], vision: false },
          },
          {
            id: 'gemini/vision',
            name: 'Vision',
            owned_by: 'gemini',
            context_length: 200000,
            max_output_tokens: 8192,
            capabilities: { tool_calling: false, reasoning: false, vision: true },
          },
        ],
      }))
      return
    }
    if (request.url === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end([
          'data: {"choices":[{"delta":{"content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}',
          'data: [DONE]',
          '',
        ].join('\n\n'))
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  return { url: `http://127.0.0.1:${address.port}/v1`, requests }
}

describe('OmniRoute adapter', () => {
  it('serves the live catalog and exact model metadata', async () => {
    const { url } = await mockOmniRoute()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(OmniRoute, { baseURL: url })

    await expect(ctx.llm.listModels('omniroute')).resolves.toEqual([
      { provider: 'omniroute', id: 'auto/cheap', name: 'Cheap', description: 'combo', inputModalities: ['text'] },
      { provider: 'omniroute', id: 'gemini/vision', name: 'Vision', description: 'gemini', inputModalities: ['text', 'image'] },
    ])
    await expect(ctx.llm.resolveModelInfo('omniroute', 'auto/cheap')).resolves.toMatchObject({
      context: { contextWindow: 1048576 },
      defaultMaxTokens: 512000,
      reasoning: { efforts: [{ id: 'none', name: 'None' }, { id: 'low', name: 'Low' }] },
    })
  })

  it('streams through OmniRoute without requiring an API key', async () => {
    const { url, requests } = await mockOmniRoute()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(OmniRoute, { baseURL: url })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'omniroute',
      model: 'auto/cheap',
      reasoningEffort: ReasoningEffortId('low'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'ping' }], source: { kind: 'user' } })],
    })) assembler.push(chunk)

    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'pong' }])
    expect(requests[0]).toMatchObject({ model: 'auto/cheap', reasoning_effort: 'low' })
  })

  it('rejects tools when OmniRoute does not report tool_calling', async () => {
    const { url } = await mockOmniRoute()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(OmniRoute, { baseURL: url })

    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'omniroute',
      model: 'gemini/vision',
      messages: [],
      tools: [{ name: 'x', description: 'x', parameters: { type: 'object' } }],
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'UNSUPPORTED_OPTION' } },
    })
  })
})
