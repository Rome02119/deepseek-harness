/**
 * Model-facing tools for ego-browser automation.
 *
 * @module @deepseek-ai/dsh-ego-browser/tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { listTaskSpaces, navigateUrl } from './cli.ts'
import type { EgoNavigateResult, EgoTaskSpace } from './types.ts'

/** Configuration options for creating ego-browser tools. */
export interface ToolConfig {
  /** Optional custom path to ego-browser executable. */
  egoPath?: string
  /** Execution timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * Create the model-facing `ego_browser_navigate` tool.
 *
 * @param config - Tool configuration options.
 * @returns The tool definition.
 */
export function createEgoBrowserNavigateTool(config: ToolConfig = {}): ToolDefinition {
  return defineTool({
    name: 'ego_browser_navigate',
    description: 'Navigate to a URL using ego-browser in an isolated task space, capturing the live rendered page snapshot, title, and structure.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'The target webpage URL to visit.',
      },
      task_space: {
        type: 'string',
        description: 'Optional name for the ego-browser task space to reuse or create (default "dsh-agent").',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          success: { type: 'boolean', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string' },
          snapshot: { type: 'string' },
          task_space_id: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const val = value as unknown as EgoNavigateResult
        if (!val.success) {
          return [{ type: 'text', text: `Failed to navigate: ${val.error ?? 'unknown error'}` }]
        }
        const parts: string[] = [
          `### ${val.title || 'Page'} (${val.url})`,
          val.snapshot || '(No snapshot available)',
        ]
        return [{ type: 'text', text: parts.join('\n\n') }]
      },
    },
    async execute(args, exec) {
      const { url, task_space } = args
      if (!url || url.trim().length === 0) {
        throw new Error('url parameter must be a non-empty string')
      }

      exec.signal.throwIfAborted()
      const res = await navigateUrl(url.trim(), {
        ...task_space ? { taskSpaceName: task_space.trim() } : {},
        ...config.egoPath !== undefined ? { customPath: config.egoPath } : {},
        ...config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {},
        signal: exec.signal,
      })

      return {
        success: res.success,
        url: res.url,
        title: res.title ?? '',
        snapshot: res.snapshot ?? '',
        task_space_id: res.taskSpaceId !== undefined ? String(res.taskSpaceId) : '',
        error: res.error ?? '',
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `ego-browser navigate: "${args.url}"`,
        kind: 'read',
        rawInput: JSON.stringify(args),
      }
    },
  })
}

/**
 * Create the model-facing `ego_browser_taskspaces` tool.
 *
 * @param config - Tool configuration options.
 * @returns The tool definition.
 */
export function createEgoBrowserTaskSpacesTool(config: ToolConfig = {}): ToolDefinition {
  return defineTool({
    name: 'ego_browser_taskspaces',
    description: 'List active task spaces in ego-browser with their IDs and ownership status.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            ownership: { type: 'string' },
          },
        },
      },
      render: (_args, value) => {
        const list = value as unknown as EgoTaskSpace[]
        if (!Array.isArray(list) || list.length === 0) {
          return [{ type: 'text', text: 'No active ego-browser task spaces found.' }]
        }
        const lines = [
          `Found ${list.length} ego-browser task space(s):`,
          ...list.map(ts => `- **${ts.name || 'Unnamed'}** (ID: \`${String(ts.id)}\`, Ownership: ${ts.ownership || 'agent'})`),
        ]
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      const spaces = await listTaskSpaces({
        ...config.egoPath !== undefined ? { customPath: config.egoPath } : {},
        ...config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {},
      })
      return spaces.map(ts => ({
        id: String(ts.id),
        name: ts.name || `Task Space ${String(ts.id)}`,
        ownership: ts.ownership || 'agent',
      }))
    },
    presentCall() {
      return {
        card: 'generic',
        title: 'List ego-browser task spaces',
        kind: 'read',
        rawInput: '',
      }
    },
  })
}
