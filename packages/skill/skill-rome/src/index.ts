/**
 * Bundled Rome's engineering skills provider.
 *
 * @module @deepseek-ai/dsh-skill-rome
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'skill-rome'

interface SkillEntryConfig {
  readonly name: string
  readonly description: string
  readonly invocation: SkillInvocationPolicy
}

const SKILL_ENTRIES: readonly SkillEntryConfig[] = [
  {
    name: 'ask-matt',
    description: 'Ask which skill or flow fits your situation. A router over the skills in this repo.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'grill-me',
    description: 'A relentless interview to sharpen a plan or design.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'grill-with-docs',
    description: "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.",
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'grilling',
    description: "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.",
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'implement',
    description: 'Implement a piece of work based on a spec or set of tickets.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'to-spec',
    description: "Turn the current conversation into a spec and publish it to the project issue tracker — no interview, just synthesis of what you've already discussed.",
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'to-tickets',
    description: 'Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker — edges as text in one file per ticket locally, or native blocking links on a real tracker.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
  {
    name: 'wayfinder',
    description: 'Plan a huge chunk of work — more than one agent session can hold — as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.',
    invocation: { modelInvocable: false, userInvocable: true },
  },
]

function extractBody(raw: string): string {
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end !== -1) {
      const bodyStart = raw.indexOf('\n', end + 4)
      return bodyStart === -1 ? '' : raw.slice(bodyStart + 1).trim()
    }
  }
  return raw.trim()
}

const CANDIDATES: SkillCandidate[] = SKILL_ENTRIES.map(entry => ({
  name: entry.name,
  description: entry.description,
  invocation: entry.invocation,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: {
    kind: 'directory',
    path: fileURLToPath(new URL(`../assets/${entry.name}/`, import.meta.url)),
  },
  rank: BUNDLED_SKILL_RANK,
  locator: new URL(`../assets/${entry.name}/SKILL.md`, import.meta.url),
}))

const CANDIDATE_MAP = new Map(CANDIDATES.map(candidate => [candidate.name, candidate]))

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate): Promise<SkillDefinition | undefined> {
    const entry = CANDIDATE_MAP.get(candidate.name)
    if (entry === undefined) return undefined
    const fileUrl = entry.locator as URL
    const raw = await readFile(fileUrl, 'utf8')
    return {
      name: entry.name,
      description: entry.description,
      invocation: entry.invocation,
      provider: entry.provider,
      source: entry.source,
      ...entry.resourceBase ? { resourceBase: entry.resourceBase } : {},
      content: extractBody(raw),
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-rome'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled Rome's skills provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
