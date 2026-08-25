/** Model-facing tools for Google NotebookLM. */

import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { listNotebooks, queryNotebook } from './cli.ts'
import type { NlmNotebook, NlmQueryResponse } from './types.ts'

/** Configuration options for creating NotebookLM tools. */
export interface ToolConfig {
  /** Optional custom path to nlm binary executable. */
  nlmPath?: string | undefined
}

/**
 * Create the model-facing `notebooklm_query` tool.
 * @param config - Tool configuration options.
 * @returns The tool definition for notebook querying.
 */
export function createNotebookLmQueryTool(config: ToolConfig = {}): ToolDefinition {
  return defineTool({
    name: 'notebooklm_query',
    description: 'Query a Google NotebookLM notebook using the local nlm CLI to retrieve factual answers and citations grounded in the notebook\'s indexed sources.',
    parameters: {
      notebook: {
        type: 'string',
        required: true,
        description: 'The Notebook ID, alias, or exact title to query.',
      },
      question: {
        type: 'string',
        required: true,
        description: 'The specific question or prompt to ask against the notebook\'s sources.',
      },
      conversation_id: {
        type: 'string',
        description: 'Optional conversation ID returned by a previous query for follow-up turns.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          answer: { type: 'string', required: true },
          conversation_id: { type: 'string', required: true },
          sources_used: {
            type: 'array',
            items: { type: 'string' },
            required: true,
          },
        },
      },
      render: (_args, value) => {
        const val = value as unknown as NlmQueryResponse
        const parts: string[] = [val.answer]
        if (val.references.length > 0) {
          parts.push('\n### Citations & Sources')
          for (const ref of val.references) {
            parts.push(`[${ref.citation_number}] ${ref.cited_text.slice(0, 180)}...`)
          }
        }
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute(args, exec) {
      const { notebook, question, conversation_id } = args as {
        notebook: string
        question: string
        conversation_id?: string | undefined
      }
      if (!notebook || notebook.trim().length === 0) {
        throw new Error('notebook parameter must be a non-empty string')
      }
      if (!question || question.trim().length === 0) {
        throw new Error('question parameter must be a non-empty string')
      }

      exec.signal.throwIfAborted()
      const res = await queryNotebook(notebook.trim(), question.trim(), {
        conversationId: conversation_id,
        customPath: config.nlmPath,
        signal: exec.signal,
      })

      return {
        answer: res.answer,
        conversation_id: res.conversation_id,
        sources_used: [...res.sources_used],
        citations: { ...res.citations } as Record<string, JsonValue>,
        references: res.references.map(r => ({ ...r })) as unknown as JsonValue,
      }
    },
    presentCall(args) {
      const parsed = args as { notebook?: string; question?: string }
      return {
        card: 'generic',
        title: `NotebookLM query: "${parsed.question ?? 'query'}" in ${parsed.notebook ?? 'notebook'}`,
        kind: 'read',
        rawInput: JSON.stringify(args),
      }
    },
  })
}

/**
 * Create the model-facing `notebooklm_list` tool.
 * @param config - Tool configuration options.
 * @returns The tool definition for notebook listing.
 */
export function createNotebookLmListTool(config: ToolConfig = {}): ToolDefinition {
  return defineTool({
    name: 'notebooklm_list',
    description: 'List all Google NotebookLM notebooks available to the user, including their titles, IDs, source counts, and last updated timestamps.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            source_count: { type: 'number', required: true },
            updated_at: { type: 'string', required: true },
          },
        },
      },
      render: (_args, value) => {
        const list = value as unknown as NlmNotebook[]
        if (!Array.isArray(list) || list.length === 0) {
          return [{ type: 'text', text: 'No Google NotebookLM notebooks found.' }]
        }
        const lines = [
          `Found ${list.length} NotebookLM notebooks:`,
          ...list.map(nb => `- **${nb.title || 'Untitled'}** (ID: \`${nb.id}\`, Sources: ${nb.source_count}, Updated: ${nb.updated_at})`),
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const notebooks = await listNotebooks({
        customPath: config.nlmPath,
        signal: exec.signal,
      })
      return notebooks.map(nb => ({
        id: nb.id,
        title: nb.title,
        source_count: nb.source_count,
        updated_at: nb.updated_at,
      }))
    },
    presentCall() {
      return {
        card: 'generic',
        title: 'List NotebookLM notebooks',
        kind: 'read',
        rawInput: '',
      }
    },
  })
}
