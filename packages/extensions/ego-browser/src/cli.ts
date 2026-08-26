/**
 * CLI runner and discovery for the local `ego-browser` tool.
 *
 * @module @deepseek-ai/dsh-ego-browser/cli
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EgoNavigateResult, EgoTaskSpace } from './types.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 5_000_000
/** Upper bound for the short discovery probes so status() can never hang. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * Run a short discovery probe, bounded so a wedged binary cannot hang the caller.
 *
 * @param command - Executable to run.
 * @param args - Arguments passed to the executable.
 * @param timeoutMs - Upper bound before the child is killed.
 * @returns Trimmed stdout on a clean exit, otherwise undefined.
 */
function probe(command: string, args: readonly string[], timeoutMs: number): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    let settled = false
    const finish = (value?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, timeoutMs)
    timer.unref()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.on('close', (code) => { finish(code === 0 && stdout.trim().length > 0 ? stdout.trim() : undefined) })
    child.on('error', () => { finish() })
  })
}


/** Standard candidate paths where ego-browser might be installed. */
function candidatePaths(customPath?: string): string[] {
  const home = homedir()
  const list: string[] = []
  if (customPath) list.push(customPath)
  if (process.env.EGO_BROWSER_PATH) list.push(process.env.EGO_BROWSER_PATH)
  list.push(
    join(home, '.local', 'bin', 'ego-browser'),
    join(home, '.ego', 'bin', 'ego-browser'),
    '/usr/local/bin/ego-browser',
    '/opt/homebrew/bin/ego-browser',
    'ego-browser',
  )
  return list
}

/**
 * Check synchronously if an ego-browser binary path candidate exists.
 *
 * @param customPath - Optional explicit path candidate.
 * @returns Whether the ego-browser binary exists.
 */
export function isEgoBinaryPresent(customPath?: string): boolean {
  if (customPath && existsSync(customPath)) return true
  if (process.env.EGO_BROWSER_PATH && existsSync(process.env.EGO_BROWSER_PATH)) return true
  const localBin = join(homedir(), '.local', 'bin', 'ego-browser')
  if (existsSync(localBin)) return true
  return false
}

/**
 * Resolve the active path to the `ego-browser` executable.
 *
 * @param customPath - Optional explicit path candidate.
 * @returns Resolved binary path or undefined.
 */
export async function findEgoBinary(customPath?: string): Promise<string | undefined> {
  const candidates = candidatePaths(customPath)
  for (const candidate of candidates) {
    if (candidate === 'ego-browser') {
      try {
        const found = await which('ego-browser')
        if (found) return found
      } catch {
        // Continue searching candidates
      }
      continue
    }
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Check if the ego-browser binary exists and runs.
 *
 * @param customPath - Optional explicit path candidate.
 * @returns Whether the ego-browser executable is found and usable.
 */
export async function isEgoAvailable(customPath?: string): Promise<boolean> {
  const bin = await findEgoBinary(customPath)
  return bin !== undefined
}

/**
 * Check if the Ego Lite app is currently running.
 *
 * @param timeoutMs - Upper bound for the probe before it is killed.
 * @returns Whether the Ego Lite desktop application is currently running.
 */
export async function isEgoAppRunning(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return await probe('pgrep', ['-f', 'ego lite'], timeoutMs) !== undefined
}

/**
 * Get version output from ego-browser CLI.
 *
 * @param customPath - Optional explicit path candidate.
 * @param timeoutMs - Upper bound for the probe before it is killed.
 * @returns Cleaned version string or undefined.
 */
export async function getEgoVersion(customPath?: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<string | undefined> {
  const bin = await findEgoBinary(customPath)
  if (!bin) return undefined
  return probe(bin, ['--version'], timeoutMs)
}

/**
 * Run a Node.js script inside the ego-browser runtime via stdin heredoc.
 *
 * @param script - JavaScript automation script to execute.
 * @param options - Execution options.
 * @returns Standard output from cliLog calls.
 */
export async function runEgoScript(
  script: string,
  options: {
    customPath?: string
    timeoutMs?: number
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const bin = await findEgoBinary(options.customPath)
  if (!bin) {
    throw new Error(
      'ego-browser executable not found. Ensure "ego lite.app" is installed and run onboarding or add ~/.local/bin to PATH.',
    )
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('Operation aborted'))
      return
    }

    const child = spawn(bin, ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}` },
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`ego-browser execution timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const onAbort = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      reject(new Error('ego-browser execution aborted'))
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += chunk
      }
    })

    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += chunk
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)

      if (code === 0) {
        resolve(stdout.trim())
      } else {
        const errorDetail = (stderr || stdout).trim()
        reject(
          new Error(
            errorDetail || `ego-browser exited with code ${code ?? 'unknown'}`,
          ),
        )
      }
    })

    // Write the script to stdin and close the stream
    child.stdin.write(script)
    child.stdin.end()
  })
}

/**
 * List all task spaces currently active in ego-browser.
 *
 * @param options - Binary path and timeout overrides.
 * @returns Active task spaces, or an empty list when ego-browser is unavailable.
 */
export async function listTaskSpaces(
  options: { customPath?: string; timeoutMs?: number } = {},
): Promise<EgoTaskSpace[]> {
  const script = `
try {
  const spaces = await listTaskSpaces();
  cliLog(JSON.stringify(spaces || []));
} catch (e) {
  cliLog(JSON.stringify([]));
}
`
  try {
    const raw = await runEgoScript(script, options)
    if (!raw) return []
    return JSON.parse(raw) as EgoTaskSpace[]
  } catch {
    return []
  }
}

/**
 * Navigate to a URL in ego-browser and capture the page snapshot and rendered HTML.
 *
 * @param url - Target webpage URL.
 * @param options - Navigation and timeout options.
 * @returns Navigation result with title, snapshot, and HTML content.
 */
export async function navigateUrl(
  url: string,
  options: {
    taskSpaceName?: string
    customPath?: string
    timeoutMs?: number
    maxChars?: number
    signal?: AbortSignal
  } = {},
): Promise<EgoNavigateResult> {
  const taskSpace = options.taskSpaceName ?? 'dsh-browser'
  const script = `
try {
  const task = await useOrCreateTaskSpace(${JSON.stringify(taskSpace)});
  await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: 25 });
  const info = await pageInfo();
  let snapshot = '';
  try {
    snapshot = await snapshotText();
  } catch (e) {}
  let html = '';
  try {
    html = await js('document.documentElement.outerHTML');
  } catch (e) {}
  cliLog(JSON.stringify({
    success: true,
    url: (info && info.url) || ${JSON.stringify(url)},
    title: (info && info.title) || '',
    snapshot: snapshot || '',
    html: html || '',
    taskSpaceId: task.id
  }));
} catch (err) {
  cliLog(JSON.stringify({
    success: false,
    url: ${JSON.stringify(url)},
    error: err && err.message ? err.message : String(err)
  }));
}
`
  try {
    const output = await runEgoScript(script, options)
    const result = JSON.parse(output) as EgoNavigateResult
    return result
  } catch (err) {
    return {
      success: false,
      url,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Resolve executable on PATH using `which`. */
function which(cmd: string): Promise<string | undefined> {
  return probe('which', [cmd], PROBE_TIMEOUT_MS)
}
