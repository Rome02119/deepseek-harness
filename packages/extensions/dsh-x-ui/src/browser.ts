/**
 * Browser option management and persistence for DSH-X UI.
 *
 * @module @deepseek-ai/dsh-x-ui/browser
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** A selectable browser option in DSH-X. */
export interface BrowserOption {
  /** Unique browser identifier ('default' or 'ego-browser'). */
  readonly id: string
  /** Human-readable display name. */
  readonly name: string
  /** Whether this browser is present and launchable on the current machine. */
  readonly available: boolean
  /** Whether this option is currently selected. */
  readonly current: boolean
  /** Path to binary executable if applicable. */
  readonly path?: string | null
  /** Reason why this option is disabled (null when available). */
  readonly reason?: string | null
  /** Brief description of this browser option. */
  readonly description: string
}

/** Complete browser selection state. */
export interface BrowserSelectionState {
  /** Active selected browser identifier. */
  readonly selected: string
  /** All available and disabled browser options. */
  readonly options: readonly BrowserOption[]
  /** Timestamp when selection was persisted. */
  readonly persistedAt?: string | null
  /** Filepath where selection is saved. */
  readonly storagePath: string
}

/** Configuration options for browser operations. */
export interface BrowserOptionsConfig {
  /** Optional custom persistence file path. */
  storagePath?: string
  /** Optional custom path to ego-browser executable. */
  customEgoPath?: string
}

/**
 * Standard candidates for ego-browser binary lookup.
 */
function candidateEgoPaths(): string[] {
  const list: string[] = []
  if (process.env.EGO_BROWSER_PATH && process.env.EGO_BROWSER_PATH.trim().length > 0) {
    list.push(process.env.EGO_BROWSER_PATH.trim())
  }
  const home = homedir()
  list.push(
    join(home, '.local', 'bin', 'ego-browser'),
    join(home, '.ego', 'bin', 'ego-browser'),
    '/usr/local/bin/ego-browser',
    '/opt/homebrew/bin/ego-browser',
  )
  return list
}

/**
 * Find the path to the ego-browser binary if present on disk.
 *
 * @param customPath - Optional explicit path candidate.
 * @returns Resolved binary path or undefined.
 */
export function findEgoBinary(customPath?: string): string | undefined {
  if (customPath !== undefined) {
    const trimmed = customPath.trim()
    if (trimmed.length > 0 && existsSync(trimmed)) {
      return trimmed
    }
    return undefined
  }
  for (const candidate of candidateEgoPaths()) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the persistent file location where user browser selection is stored.
 *
 * @param customPath - Optional explicit path.
 * @returns Resolved absolute file path.
 */
export function resolveStoragePath(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) return customPath.trim()
  if (process.env.DSH_BROWSER_SELECTION_FILE && process.env.DSH_BROWSER_SELECTION_FILE.trim().length > 0) {
    return process.env.DSH_BROWSER_SELECTION_FILE.trim()
  }
  return join(homedir(), '.dsh', 'browser-selection.json')
}

/**
 * Read the saved browser selection from disk if available.
 */
function readPersistedSelection(storagePath: string): { selected?: string; updatedAt?: string } | null {
  try {
    if (!existsSync(storagePath)) return null
    const raw = readFileSync(storagePath, 'utf8')
    return JSON.parse(raw) as { selected?: string; updatedAt?: string }
  } catch {
    return null
  }
}

/**
 * Write the browser selection to disk for persistence across restarts.
 */
function writePersistedSelection(selected: string, storagePath: string): string {
  const updatedAt = new Date().toISOString()
  mkdirSync(dirname(storagePath), { recursive: true })
  writeFileSync(storagePath, JSON.stringify({ selected, updatedAt }, null, 2), 'utf8')
  return updatedAt
}

/**
 * Get current browser selection state and available options.
 *
 * @param config - Options for storage and executable resolution.
 * @returns The current browser selection state.
 */
export function getBrowserSelectionState(config: BrowserOptionsConfig = {}): BrowserSelectionState {
  const storagePath = resolveStoragePath(config.storagePath)
  const persisted = readPersistedSelection(storagePath)

  const egoBin = findEgoBinary(config.customEgoPath)
  const egoAvailable = egoBin !== undefined

  let selected = persisted?.selected ?? 'default'
  if (selected !== 'default' && selected !== 'ego-browser') {
    selected = 'default'
  }

  const options: BrowserOption[] = [
    {
      id: 'default',
      name: 'System Default Browser',
      available: true,
      current: selected === 'default',
      path: null,
      reason: null,
      description: 'Standard operating system default web browser (open / xdg-open)',
    },
    {
      id: 'ego-browser',
      name: 'ego-browser (Ego Lite)',
      available: egoAvailable,
      current: selected === 'ego-browser',
      path: egoBin ?? null,
      reason: egoAvailable
        ? null
        : 'ego-browser executable not found in PATH or ~/.local/bin. Install ego lite.app or complete onboarding.',
      description: 'Lightweight Chromium-based browser with isolated task spaces and agent automation',
    },
  ]

  return {
    selected,
    options,
    persistedAt: persisted?.updatedAt ?? null,
    storagePath,
  }
}

/**
 * Select a browser option and persist the choice across restarts.
 *
 * @param browserId - 'default' or 'ego-browser'.
 * @param config - Options for storage and validation.
 * @returns The updated browser selection state.
 */
export function selectBrowserOption(
  browserId: string,
  config: BrowserOptionsConfig = {},
): BrowserSelectionState {
  if (browserId !== 'default' && browserId !== 'ego-browser') {
    throw new Error(`Invalid browser "${browserId}". Choose "default" or "ego-browser".`)
  }

  const storagePath = resolveStoragePath(config.storagePath)
  const egoBin = findEgoBinary(config.customEgoPath)
  const egoAvailable = egoBin !== undefined

  if (browserId === 'ego-browser' && !egoAvailable) {
    throw new Error(
      'Cannot select ego-browser: executable not found on this machine. Install ego lite.app or add ~/.local/bin to PATH.',
    )
  }

  writePersistedSelection(browserId, storagePath)

  return getBrowserSelectionState(config)
}

/**
 * Launch a URL in the selected or specified browser using safe argv-style execution.
 *
 * @param url - Webpage URL to open.
 * @param config - Configuration including optional browserId override.
 * @returns Result object with launch confirmation.
 */
export async function launchBrowserUrl(
  url: string,
  config: BrowserOptionsConfig & { browserId?: string; taskSpace?: string } = {},
): Promise<{ success: boolean; browser: string; url: string; output?: string }> {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('URL must be a non-empty string')
  }
  const targetUrl = url.trim()

  const state = getBrowserSelectionState(config)
  const browserId = config.browserId ?? state.selected

  if (browserId === 'ego-browser') {
    const egoBin = findEgoBinary(config.customEgoPath)
    if (!egoBin) {
      throw new Error(
        'Cannot launch ego-browser: executable not found. Ensure ego lite.app is installed.',
      )
    }

    const taskSpaceName = config.taskSpace ?? 'dsh-browser'
    const script = `
try {
  const task = await useOrCreateTaskSpace(${JSON.stringify(taskSpaceName)});
  await openOrReuseTab(${JSON.stringify(targetUrl)}, { wait: false });
  cliLog(JSON.stringify({ success: true, taskSpaceId: task.id }));
} catch (err) {
  cliLog(JSON.stringify({ success: false, error: err && err.message ? err.message : String(err) }));
}
`
    return new Promise((resolve, reject) => {
      const child = spawn(egoBin, ['nodejs'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { HOME: homedir(), PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}` },
      })

      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (c: string) => { stdout += c })
      child.stderr.on('data', (c: string) => { stderr += c })

      child.on('error', (err) => { reject(err) })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, browser: 'ego-browser', url: targetUrl, output: stdout.trim() })
        } else {
          reject(new Error(stderr.trim() || stdout.trim() || `ego-browser exited with code ${code}`))
        }
      })

      child.stdin.write(script)
      child.stdin.end()
    })
  }

  // Default system browser: launch argv-style using platform opener
  return new Promise((resolve, reject) => {
    let cmd: string
    let args: string[]

    if (process.platform === 'darwin') {
      cmd = 'open'
      args = [targetUrl]
    } else if (process.platform === 'win32') {
      cmd = 'explorer.exe'
      args = [targetUrl]
    } else {
      cmd = 'xdg-open'
      args = [targetUrl]
    }

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    })

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => { stderr += c })

    child.on('error', (err) => { reject(err) })
    child.unref()

    // Resolve immediately on successful spawn
    setImmediate(() => {
      if (stderr.length > 0) {
        reject(new Error(`Failed to launch default browser: ${stderr.trim()}`))
      } else {
        resolve({ success: true, browser: 'default', url: targetUrl })
      }
    })
  })
}
