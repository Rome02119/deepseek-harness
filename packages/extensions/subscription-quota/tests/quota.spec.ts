import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SubscriptionQuotaService, { subscriptionQuotaSnapshot } from '../src/index.ts'

describe('subscription quota projection', () => {
  it('keeps unavailable values unknown', () => {
    const snapshot = subscriptionQuotaSnapshot(new Date('2026-08-24T23:00:00.000Z'))
    expect(snapshot.checkedAt).toBe('2026-08-24T23:00:00.000Z')
    expect(snapshot.sources).toHaveLength(4)
    expect(snapshot.sources.every(source => source.usage === 'unknown')).toBe(true)
    expect(snapshot.sources.every(source => source.limit === 'unknown')).toBe(true)
    expect(snapshot.sources.every(source => source.remaining === 'unknown')).toBe(true)
  })

  it('guards both HTTP routes', async () => {
    const ctx = new Context()
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(SubscriptionQuotaService)
    for (const path of ['/subscription-quota.json', '/subscription-quota']) {
      expect((await fetch(`http://127.0.0.1:${ctx.webServer.port}${path}`, { headers: { origin: 'https://attacker.example' } })).status, path).toBe(401)
    }
    await ctx.fiber.dispose()
  })
})
