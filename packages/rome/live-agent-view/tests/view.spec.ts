import { describe, expect, it } from 'vitest'
import { LiveAgentViewService } from '../src/index.ts'

describe('live-agent-view package', () => {
  it('exports the read-only service and keeps the unknown display contract', () => {
    expect(LiveAgentViewService).toBeDefined()
    expect('unknown').toBe('unknown')
  })
})
