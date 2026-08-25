import { describe, expect, it } from 'vitest'
import { subscriptionQuotaSnapshot } from '../src/index.ts'

describe('subscription quota projection', () => {
  it('keeps unavailable values unknown', () => {
    const snapshot = subscriptionQuotaSnapshot(new Date('2026-08-24T23:00:00.000Z'))
    expect(snapshot.checkedAt).toBe('2026-08-24T23:00:00.000Z')
    expect(snapshot.sources).toHaveLength(4)
    expect(snapshot.sources.every(source => source.usage === 'unknown')).toBe(true)
    expect(snapshot.sources.every(source => source.limit === 'unknown')).toBe(true)
    expect(snapshot.sources.every(source => source.remaining === 'unknown')).toBe(true)
  })
})
