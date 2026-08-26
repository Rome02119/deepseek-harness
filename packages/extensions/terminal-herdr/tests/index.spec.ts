import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import { apply, HerdrTerminalBackend, workspaceId } from '../src/index.ts'

describe('terminal-herdr', () => {
  it('reuses a matching herdr workspace', () => {
    expect(workspaceId({ result: { workspaces: [{ cwd: '/repo', label: 'DSH-X', workspace_id: 'w1' }] } }, '/repo', 'DSH-X')).toBe('w1')
    expect(workspaceId({ result: { workspaces: [{ label: 'DSH-X', workspace_id: 'w2' }] } }, '/repo', 'DSH-X')).toBe('w2')
    expect(workspaceId({ result: { workspaces: [{ label: 'other', workspace_id: 'w3' }] } }, '/repo', 'DSH-X')).toBeUndefined()
  })

  it('registers the herdr backend type', () => {
    expect(new HerdrTerminalBackend({ command: 'herdr', workspaceLabel: 'DSH-X', readDelayMs: 0 }).type).toBe('herdr')
  })

  it('creates workspace and tab when no existing workspace matches', async () => {
    const calls: string[][] = []
    const backend = new HerdrTerminalBackend(
      { command: 'herdr', workspaceLabel: 'DSH-X', readDelayMs: 0 },
      (args) => {
        calls.push([...args])
        if (args[0] === 'workspace' && args[1] === 'list') return JSON.stringify({ result: { workspaces: [] } })
        if (args[0] === 'workspace' && args[1] === 'create') return JSON.stringify({ result: { root_pane: { pane_id: 'wCreated:p1' } } })
        if (args[0] === 'tab' && args[1] === 'create') return JSON.stringify({ result: { root_pane: { pane_id: 'wCreated:p2' } } })
        if (args[0] === 'pane' && args[1] === 'read') return 'line1\nline2\nline3\n'
        return ''
      },
    )
    const session = await backend.spawn({ cwd: '/repo', name: 'agent-tab', owner: {} as never, sessionId: 'pty-1' as never, type: 'herdr' })
    expect(session.motd).toBe('')
    expect(calls).toContainEqual(['workspace', 'create', '--cwd', '/repo', '--label', 'DSH-X'])
    expect(calls).toContainEqual(['tab', 'create', '--workspace', 'wCreated', '--cwd', '/repo', '--label', 'agent-tab'])

    // pagination test
    const paged = session.read({ count: 2, offset: 1 })
    expect(paged.text).toBe('line2\nline3')
    expect(paged.totalLines).toBe(4)

    // signal tests
    await expect(session.signal('SIGTERM')).rejects.toThrow('herdr does not support SIGTERM for pane input')
    const sigintResult = await session.signal('SIGINT')
    expect(sigintResult.delivered).toBe(true)
    expect(calls).toContainEqual(['pane', 'send-keys', 'wCreated:p2', 'Ctrl-C'])
  })

  it('opens, sends to, reads, and closes a real pane through argv calls', async () => {
    const calls: string[][] = []
    const backend = new HerdrTerminalBackend(
      { command: 'herdr', workspaceLabel: 'DSH-X', readDelayMs: 0 },
      (args) => {
        calls.push([...args])
        if (args[0] === 'workspace') return JSON.stringify({ result: { workspaces: [{ cwd: '/repo', label: 'DSH-X', workspace_id: 'w1' }] } })
        if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p2' } } })
        if (args[1] === 'read') return 'HERDR_PANE_OK\n'
        return ''
      },
    )
    const pane = await backend.spawn({ cwd: '/repo', name: 'web', owner: {} as never, sessionId: 'pty-1' as never, type: 'herdr' })
    expect(pane.status()).toEqual({ kind: 'running' })
    expect(pane.read({}).text).toContain('HERDR_PANE_OK')

    // send with submit: true
    const op1 = pane.startSend({ text: 'echo HERDR_PANE_OK', submit: true })
    const res1 = await op1.done
    expect(res1.viewport).toContain('HERDR_PANE_OK')
    expect(op1.readOutput()).toEqual({ delta: '', truncated: false })
    expect(op1.readOutput()).toEqual({ delta: '', truncated: false })
    expect(op1.cancel()).toBe(false)

    // send with submit: false
    await pane.startSend({ text: 'no-enter', submit: false }).done

    // close
    await pane.close('test')
    expect(pane.status()).toEqual({ kind: 'exited', exitCode: null, signal: null })
    // idempotent close
    await pane.close('test again')

    expect(calls).toContainEqual(['pane', 'send-text', 'w1:p2', 'echo HERDR_PANE_OK'])
    expect(calls).toContainEqual(['pane', 'send-keys', 'w1:p2', 'Enter'])
    expect(calls).toContainEqual(['pane', 'send-text', 'w1:p2', 'no-enter'])
    expect(calls).toContainEqual(['pane', 'close', 'w1:p2'])
  })

  it('fails with clear actionable error when herdr executable is missing', async () => {
    const backend = new HerdrTerminalBackend({ command: '/path/to/nonexistent/herdr', workspaceLabel: 'DSH-X', readDelayMs: 0 })
    await expect(backend.spawn({ cwd: '/repo', owner: {} as never, sessionId: 'pty-1' as never, type: 'herdr' })).rejects.toThrow(
      'herdr executable was not found at /path/to/nonexistent/herdr; install herdr or set terminal-herdr.command.',
    )
  })

  it('retries on connection refused', async () => {
    let attempts = 0
    const backend = new HerdrTerminalBackend(
      { command: 'herdr', workspaceLabel: 'DSH-X', readDelayMs: 0 },
      (args) => {
        if (args[0] === 'workspace' && args[1] === 'list') {
          attempts++
          if (attempts === 1) {
            throw new Error('Connection refused (os error 61)')
          }
          return JSON.stringify({ result: { workspaces: [{ label: 'DSH-X', workspace_id: 'w1' }] } })
        }
        if (args[0] === 'tab') return JSON.stringify({ result: { root_pane: { pane_id: 'w1:p2' } } })
        return ''
      },
    )
    const session = await backend.spawn({ cwd: '/repo', owner: {} as never, sessionId: 'pty-1' as never, type: 'herdr' })
    expect(session).toBeDefined()
    expect(attempts).toBe(2)
  })

  it('registers backend on Context via apply', () => {
    const ctx = new Context()
    new TerminalSessionService(ctx)
    apply(ctx, { command: '/opt/homebrew/bin/herdr', workspaceLabel: 'DSH-X', readDelayMs: 250 })
    expect(ctx.terminals.listBackends()).toContain('herdr')
  })
})
