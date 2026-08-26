import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Invariants from '@deepseek-ai/dsh-invariants'
import { DshXUiService } from '../src/index.ts'
import {
  getBrowserSelectionState,
  selectBrowserOption,
  launchBrowserUrl,
} from '../src/browser.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('DSH-X browser options and persistence', () => {
  it('lists browser options with default selected initially', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-x-browser-test-'))
    tempDirs.push(root)
    const storageFile = join(root, 'browser-selection.json')

    const state = getBrowserSelectionState({ storagePath: storageFile })
    expect(state.selected).toBe('default')
    expect(state.options.length).toBeGreaterThanOrEqual(2)

    const defaultOpt = state.options.find(o => o.id === 'default')
    expect(defaultOpt).toBeDefined()
    expect(defaultOpt?.available).toBe(true)
    expect(defaultOpt?.current).toBe(true)

    const egoOpt = state.options.find(o => o.id === 'ego-browser')
    expect(egoOpt).toBeDefined()
    expect(typeof egoOpt?.available).toBe('boolean')
    expect(egoOpt?.current).toBe(false)
  })

  it('persists ego-browser selection across restarts', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-x-browser-test-'))
    tempDirs.push(root)
    const storageFile = join(root, 'browser-selection.json')

    // 1. Select ego-browser
    const updated = selectBrowserOption('ego-browser', { storagePath: storageFile })
    expect(updated.selected).toBe('ego-browser')
    expect(existsSync(storageFile)).toBe(true)

    // 2. Read state again (simulating fresh restart)
    const restored = getBrowserSelectionState({ storagePath: storageFile })
    expect(restored.selected).toBe('ego-browser')
    const egoOpt = restored.options.find(o => o.id === 'ego-browser')
    expect(egoOpt?.current).toBe(true)

    // 3. Switch back to default and verify persistence
    const backToDefault = selectBrowserOption('default', { storagePath: storageFile })
    expect(backToDefault.selected).toBe('default')

    const restoredDefault = getBrowserSelectionState({ storagePath: storageFile })
    expect(restoredDefault.selected).toBe('default')
  })

  it('disables ego-browser option with clear reason when binary is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-x-browser-test-'))
    tempDirs.push(root)
    const storageFile = join(root, 'browser-selection.json')
    const nonExistentBin = join(root, 'non-existent-ego-binary')

    const state = getBrowserSelectionState({
      storagePath: storageFile,
      customEgoPath: nonExistentBin,
    })

    const egoOpt = state.options.find(o => o.id === 'ego-browser')
    expect(egoOpt).toBeDefined()
    expect(egoOpt?.available).toBe(false)
    expect(egoOpt?.reason).toContain('not found')

    // Attempting to select unavailable option should throw descriptive error
    expect(() => {
      selectBrowserOption('ego-browser', {
        storagePath: storageFile,
        customEgoPath: nonExistentBin,
      })
    }).toThrow(/not available|not found/i)

    expect(() => {
      selectBrowserOption('ego-browser', {
        storagePath: storageFile,
        customEgoPath: nonExistentBin,
      })
    }).toThrow(/not available|not found/i)
  })

  it('serves browser selection and actions over HTTP via DshXUiService', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-x-ui-test-'))
    tempDirs.push(root)
    const storageFile = join(root, 'browser-selection.json')
    process.env.DSH_BROWSER_SELECTION_FILE = storageFile

    const ctx = new Context()
    await ctx.plugin(Invariants)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })

    // Minimal mock services for DshXUiService
    ctx.provide('agents', { list: () => [], get: () => undefined } as never)
    ctx.provide('loader', { entries: () => [] } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('terminals', { list: () => [], spawn: () => Promise.resolve({ sessionId: '1' }), startSend: () => ({ done: Promise.resolve({}) }), kill: () => Promise.resolve(true), read: () => ({ text: '' }) } as never)

    await ctx.plugin(DshXUiService)
    const port = ctx.webServer.port
    expect(port).toBeGreaterThan(0)

    // 1. GET /dsh-x/api/browser
    const getRes = await fetch(`http://127.0.0.1:${port}/dsh-x/api/browser`)
    expect(getRes.status).toBe(200)
    const getJson = (await getRes.json()) as { selected: string; options: unknown[] }
    expect(getJson.selected).toBe('default')
    expect(Array.isArray(getJson.options)).toBe(true)

    // 2. POST /dsh-x/api/browser/select
    const postRes = await fetch(`http://127.0.0.1:${port}/dsh-x/api/browser/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ browser: 'ego-browser' }),
    })
    expect(postRes.status).toBe(200)
    const postJson = (await postRes.json()) as { success: boolean; selected: string }
    expect(postJson.success).toBe(true)
    expect(postJson.selected).toBe('ego-browser')

    // 3. Verify in state API /dsh-x/api/state
    const stateRes = await fetch(`http://127.0.0.1:${port}/dsh-x/api/state`)
    expect(stateRes.status).toBe(200)
    const stateJson = (await stateRes.json()) as { browser?: { selected: string } }
    expect(stateJson.browser).toBeDefined()
    expect(stateJson.browser?.selected).toBe('ego-browser')

    delete process.env.DSH_BROWSER_SELECTION_FILE
    await ctx.fiber.dispose()
  })

  it('rejects invalid browser selection and validates launch URLs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-x-browser-test-'))
    tempDirs.push(root)
    const storageFile = join(root, 'browser-selection.json')

    expect(() => {
      selectBrowserOption('safari-custom', { storagePath: storageFile })
    }).toThrow('Invalid browser "safari-custom". Choose "default" or "ego-browser".')

    await expect(launchBrowserUrl('', { storagePath: storageFile })).rejects.toThrow('URL must be a non-empty string')

    const nonExistentBin = join(root, 'missing-ego')
    await expect(
      launchBrowserUrl('https://example.com', {
        storagePath: storageFile,
        browserId: 'ego-browser',
        customEgoPath: nonExistentBin,
      }),
    ).rejects.toThrow(/Cannot launch ego-browser: executable not found/)
  })
})
