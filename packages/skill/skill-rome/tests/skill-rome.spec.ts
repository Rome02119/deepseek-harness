import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillRome from '@deepseek-ai/dsh-skill-rome'

describe('dsh-skill-rome', () => {
  it('registers and disposes all 8 bundled rome skills', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillRome)

    const list = await ctx.skills.list()
    expect(list).toHaveLength(8)

    const expectedNames = [
      'ask-matt',
      'grill-me',
      'grill-with-docs',
      'grilling',
      'implement',
      'to-spec',
      'to-tickets',
      'wayfinder',
    ]
    expect(list.map(s => s.name)).toEqual(expectedNames)

    for (const name of expectedNames) {
      const candidate = list.find(s => s.name === name)
      expect(candidate).toBeDefined()
      expect(candidate?.provider).toBe('skill-rome')
      expect(candidate?.source).toBe('bundled')
      expect(candidate?.invocation.userInvocable).toBe(true)

      const resourcePath = fileURLToPath(new URL(`../assets/${name}/`, import.meta.url))
      expect(candidate?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

      const loaded = await ctx.skills.get(name)
      expect(loaded).toBeDefined()
      expect(loaded?.name).toBe(name)
      expect(loaded?.description).toBe(candidate?.description)
      expect(loaded?.content.length).toBeGreaterThan(0)
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })
    }

    // Check specific model invocation policies
    const grilling = list.find(s => s.name === 'grilling')
    expect(grilling?.invocation.modelInvocable).toBe(true)

    const askMatt = list.find(s => s.name === 'ask-matt')
    expect(askMatt?.invocation.modelInvocable).toBe(false)
    const toSpec = list.find(s => s.name === 'to-spec')
    expect(toSpec?.invocation.modelInvocable).toBe(false)

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })
})
