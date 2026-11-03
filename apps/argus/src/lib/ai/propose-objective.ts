import { z } from 'zod'
import { generateJson, hasGeminiKey, type GeminiOptions } from './gemini'

export const ObjectiveProposal = z.object({
  title: z.string().min(3).max(140),
  description: z.string().max(1000),
  watch: z.array(z.string().min(2).max(200)).min(1).max(8),
  signal_kinds: z.array(z.enum(['competitor_offer', 'pricing', 'demand', 'complaint', 'trend', 'audience', 'engagement'])).min(1),
  ad_library_terms: z.array(z.string().min(2).max(60)).max(5),
  cadence: z.enum(['daily', 'weekly']),
})
export type ObjectiveProposal = z.infer<typeof ObjectiveProposal>

export interface CompanyProfile {
  name: string
  description: string
  country: string
  city: string | null
  sources: Array<{ kind: string; name: string }>
}

/** The objective Argus proposes when the AI is unavailable. Never blocks onboarding. */
export function defaultObjective(c: CompanyProfile): ObjectiveProposal {
  const where = c.city ? `${c.city}, ${c.country}` : c.country
  return {
    title: `Watch the Facebook market around ${c.name}`,
    description: `Track what competitors and similar businesses in ${where} publish and advertise on Facebook, what people react to, and what they complain about, so ${c.name} can see openings early.`,
    watch: ['competitor posts and offers', 'ads running in the market', 'reactions and comments on our own page'],
    signal_kinds: ['competitor_offer', 'pricing', 'demand', 'complaint', 'engagement'],
    ad_library_terms: [],
    cadence: 'daily',
  }
}

const SYSTEM = `You are Argus, a market analyst for small companies. Given a company profile, propose ONE default
market-watch objective that uses Facebook data (the company's own page, competitor pages, and the public Meta Ad
Library). Be concrete and local. ad_library_terms are short search phrases (in the market's language) that
competitors would use in ads. Do not invent facts about the company. Return JSON only.`

export async function proposeObjective(
  c: CompanyProfile,
  opts: GeminiOptions = {},
): Promise<{ proposal: ObjectiveProposal; by: 'ai' | 'default'; tokens: number }> {
  if (!opts.apiKey && !opts.fetchImpl && !hasGeminiKey()) return { proposal: defaultObjective(c), by: 'default', tokens: 0 }
  const user = JSON.stringify({
    company: { name: c.name, description: c.description, country: c.country, city: c.city },
    connected_sources: c.sources,
    output_shape: {
      title: 'string',
      description: 'string, 1-3 sentences',
      watch: ['what to watch'],
      signal_kinds: ['competitor_offer|pricing|demand|complaint|trend|audience|engagement'],
      ad_library_terms: ['search phrase'],
      cadence: 'daily|weekly',
    },
  })
  try {
    const { data, tokens } = await generateJson(SYSTEM, user, ObjectiveProposal, opts)
    return { proposal: data, by: 'ai', tokens }
  } catch {
    return { proposal: defaultObjective(c), by: 'default', tokens: 0 }
  }
}
