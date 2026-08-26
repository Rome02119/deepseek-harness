/** Wrapper around the local `nlm` CLI for Google NotebookLM. */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type {
  NlmCreateNotebookResponse,
  NlmDoctorResult,
  NlmNotebook,
  NlmNotebookDescription,
  NlmQueryResponse,
  NlmSource,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_LIST_TIMEOUT_MS = 30_000
const CACHE_TTL_MS = 60_000

/** Cache entry for notebook list. */
interface CachedNotebooks {
  timestamp: number
  data: NlmNotebook[]
}

let cachedNotebooks: CachedNotebooks | null = null

/** Candidate locations to check for nlm binary. */
function candidateNlmPaths(customPath?: string): string[] {
  const home = homedir()
  const paths: string[] = []
  if (customPath && customPath.trim().length > 0) {
    paths.push(customPath.trim())
  }
  // User local bin
  paths.push('/Users/rome/.local/bin/nlm')
  paths.push(join(home, '.local', 'bin', 'nlm'))
  paths.push('/usr/local/bin/nlm')
  paths.push('/opt/homebrew/bin/nlm')
  paths.push('nlm')
  return paths
}

/**
 * Resolve the nlm executable path.
 * @param customPath - Optional user-configured path to nlm.
 * @returns The resolved executable path or fallback string.
 */
export async function findNlmBinary(customPath?: string): Promise<string> {
  const candidates = candidateNlmPaths(customPath)
  for (const candidate of candidates) {
    if (candidate === 'nlm') continue
    if (existsSync(candidate)) return candidate
  }
  // Try running 'nlm --version' directly via PATH
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 3000)
    try {
      await runNativeCommand('nlm', ['--version'], controller.signal)
      return 'nlm'
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // If not found in PATH or standard dirs, return the primary candidate for descriptive error reporting
    return candidates[0] ?? '/Users/rome/.local/bin/nlm'
  }
}

/** Format error message for human clarity. */
function normalizeNlmError(error: unknown, cliPath: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const stderr = typeof error === 'object' && error !== null && 'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
    ? (error as { stderr: string }).stderr
    : ''
  const combined = `${message}\n${stderr}`.trim()

  if (combined.includes('ENOENT') || combined.includes('not found')) {
    return new Error(
      `nlm CLI was not found at "${cliPath}". Please ensure the nlm tool is installed (e.g. at /Users/rome/.local/bin/nlm).`,
      { cause: error },
    )
  }
  if (combined.includes('Authentication') || combined.includes('login') || combined.includes('cookies') || combined.includes('401') || combined.includes('403')) {
    return new Error(
      'nlm is not authenticated with Google NotebookLM. Please run "nlm login" in your terminal to sign in.',
      { cause: error },
    )
  }
  if (combined.includes('ETIMEDOUT') || combined.includes('aborted') || combined.includes('timed out')) {
    return new Error('nlm operation timed out. NotebookLM CLI did not respond in time.', { cause: error })
  }
  return new Error(`nlm failed: ${combined.length > 0 ? combined : 'Unknown CLI error'}`, { cause: error })
}

/**
 * Execute an nlm command with JSON output parsing.
 * @param args - Subcommand arguments to pass to nlm.
 * @param options - Execution options including customPath, timeoutMs, and signal.
 * @returns The parsed JSON payload or text wrapper.
 */
export async function execNlm<T>(
  args: readonly string[],
  options: {
    customPath?: string | undefined
    timeoutMs?: number | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<T> {
  const cliPath = await findNlmBinary(options.customPath)
  const controller = new AbortController()
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const abortOnUpstream = (): void => {
    controller.abort()
  }
  if (options.signal) {
    if (options.signal.aborted) throw new Error('Operation aborted')
    options.signal.addEventListener('abort', abortOnUpstream, { once: true })
  }

  const timer = setTimeout(() => {
    controller.abort(new Error(`nlm command timed out after ${timeout / 1000}s`))
  }, timeout)

  try {
    const { stdout, stderr } = await runNativeCommand(cliPath, args, controller.signal)
    clearTimeout(timer)
    if (options.signal) {
      options.signal.removeEventListener('abort', abortOnUpstream)
    }

    const trimmed = stdout.trim()
    if (trimmed.length === 0) {
      if (stderr.trim().length > 0) {
        throw new Error(stderr.trim())
      }
      return {} as T
    }

    try {
      return JSON.parse(trimmed) as T
    } catch {
      // If output is not valid JSON, return raw text or structured wrapper
      return { raw: trimmed, message: trimmed } as unknown as T
    }
  } catch (err) {
    clearTimeout(timer)
    if (options.signal) {
      options.signal.removeEventListener('abort', abortOnUpstream)
    }
    throw normalizeNlmError(err, cliPath)
  }
}

/**
 * List all notebooks from nlm CLI.
 * @param options - Options including customPath, signal, and forceRefresh.
 * @returns List of notebooks sorted by update timestamp.
 */
export async function listNotebooks(
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
    forceRefresh?: boolean | undefined
  } = {},
): Promise<NlmNotebook[]> {
  const now = Date.now()
  if (!options.forceRefresh && cachedNotebooks && now - cachedNotebooks.timestamp < CACHE_TTL_MS) {
    return cachedNotebooks.data
  }

  const raw = await execNlm<NlmNotebook[]>(['list', 'notebooks', '--json'], {
    customPath: options.customPath,
    timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    signal: options.signal,
  })

  if (!Array.isArray(raw)) {
    throw new Error('nlm list notebooks returned non-array payload')
  }

  // Sort newest first by updated_at
  const notebooks = [...raw].sort((a, b) => {
    const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return timeB - timeA
  })

  cachedNotebooks = { timestamp: now, data: notebooks }
  return notebooks
}

/**
 * List sources inside a notebook.
 * @param notebookId - The notebook UUID or identifier.
 * @param options - Options including customPath and signal.
 * @returns List of sources in the notebook.
 */
export async function listSources(
  notebookId: string,
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<NlmSource[]> {
  const raw = await execNlm<NlmSource[]>(['source', 'list', notebookId, '--json'], {
    customPath: options.customPath,
    timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    signal: options.signal,
  })
  return Array.isArray(raw) ? raw : []
}

/**
 * Query a notebook with a question.
 * @param notebookId - The notebook UUID or identifier.
 * @param question - The question prompt to query against sources.
 * @param options - Options including conversationId, sourceIds, customPath, signal, timeoutMs.
 * @returns Structured answer with citations and references.
 */
export async function queryNotebook(
  notebookId: string,
  question: string,
  options: {
    conversationId?: string | undefined
    sourceIds?: readonly string[] | undefined
    customPath?: string | undefined
    signal?: AbortSignal | undefined
    timeoutMs?: number | undefined
  } = {},
): Promise<NlmQueryResponse> {
  const args = ['query', 'notebook', notebookId, question, '--json']
  if (options.conversationId && options.conversationId.trim().length > 0) {
    args.push('--conversation-id', options.conversationId.trim())
  }
  if (options.sourceIds && options.sourceIds.length > 0) {
    args.push('--source-ids', options.sourceIds.join(','))
  }

  const res = await execNlm<NlmQueryResponse>(args, {
    customPath: options.customPath,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })

  return {
    answer: res.answer,
    conversation_id: res.conversation_id,
    sources_used: Array.isArray(res.sources_used) ? res.sources_used : [],
    citations: res.citations,
    references: Array.isArray(res.references) ? res.references : [],
  }
}

/**
 * Create a new notebook.
 * @param title - The title for the new notebook.
 * @param options - Options including customPath and signal.
 * @returns Created notebook metadata.
 */
export async function createNotebook(
  title: string,
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<NlmCreateNotebookResponse> {
  const res = await execNlm<NlmCreateNotebookResponse>(['create', 'notebook', title], {
    customPath: options.customPath,
    timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    signal: options.signal,
  })
  // Invalidate cache
  cachedNotebooks = null
  return res
}

/**
 * Add a URL source to a notebook.
 * @param notebookId - The notebook UUID.
 * @param url - Web URL to index as a source.
 * @param options - Options including customPath and signal.
 * @returns Success status and confirmation message.
 */
export async function addSourceUrl(
  notebookId: string,
  url: string,
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<{ success: boolean; message: string }> {
  const res = await execNlm<{ message?: string }>(['add', 'url', notebookId, url], {
    customPath: options.customPath,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })
  cachedNotebooks = null
  return { success: true, message: res.message ?? `Added URL source ${url}` }
}

/**
 * Add a text source to a notebook.
 * @param notebookId - The notebook UUID.
 * @param text - Plain text or note content to index.
 * @param title - Optional title for the note.
 * @param options - Options including customPath and signal.
 * @returns Success status and confirmation message.
 */
export async function addSourceText(
  notebookId: string,
  text: string,
  title?: string,
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<{ success: boolean; message: string }> {
  const args = ['add', 'text', notebookId, text]
  if (title && title.trim().length > 0) {
    args.push('--title', title.trim())
  }
  const res = await execNlm<{ message?: string }>(args, {
    customPath: options.customPath,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })
  cachedNotebooks = null
  return { success: true, message: res.message ?? 'Added text source' }
}

/**
 * Describe a notebook (AI summary & suggested topics).
 * @param notebookId - The notebook UUID.
 * @param options - Options including customPath and signal.
 * @returns Summary description and topics.
 */
export async function describeNotebook(
  notebookId: string,
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<NlmNotebookDescription> {
  const res = await execNlm<NlmNotebookDescription>(['describe', 'notebook', notebookId, '--json'], {
    customPath: options.customPath,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })
  return {
    summary: Array.isArray(res.summary) ? res.summary : [],
    suggested_topics: Array.isArray(res.suggested_topics) ? res.suggested_topics : [],
  }
}

/**
 * Run nlm doctor for status diagnosis.
 * @param options - Options including customPath and signal.
 * @returns Diagnostics result with auth and version info.
 */
export async function runDoctor(
  options: {
    customPath?: string | undefined
    signal?: AbortSignal | undefined
  } = {},
): Promise<NlmDoctorResult> {
  const cliPath = await findNlmBinary(options.customPath)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 10_000)

  try {
    const { stdout, stderr } = await runNativeCommand(cliPath, ['doctor'], controller.signal)
    clearTimeout(timer)
    const combined = `${stdout}\n${stderr}`.trim()
    const authenticated = combined.includes('Cookies: present') || !combined.includes('not logged in')
    const versionMatch = /notebooklm-mcp-cli:\s*([0-9.]+)/i.exec(combined)
    return {
      installed: true,
      version: versionMatch ? versionMatch[1] : '0.8.1',
      cliPath,
      authenticated,
      rawOutput: combined,
    }
  } catch (err) {
    clearTimeout(timer)
    return {
      installed: false,
      cliPath,
      authenticated: false,
      rawOutput: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
