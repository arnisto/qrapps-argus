import { createHash } from 'node:crypto'
import { z } from 'zod'
import { generateJson, type GeminiOptions } from './gemini'

export interface FilterItem {
  id: string
  source_name: string
  kind: 'post' | 'comment' | 'ad' | 'insight'
  text: string
  metrics: Record<string, number>
  posted_at: string | null
}

export const FilterVerdict = z.object({
  id: z.string(),
  keep: z.boolean(),
  importance: z.number().int().min(1).max(5),
  kind: z.string().min(2).max(40),
  summary: z.string().max(400),
  numbers: z.record(z.string(), z.number()).default({}),
  entities: z.array(z.string().max(80)).max(10).default([]),
  reason: z.string().min(3).max(300),
})
export const FilterResponse = z.object({ verdicts: z.array(FilterVerdict) })
export type FilterVerdict = z.infer<typeof FilterVerdict>

/**
 * Deterministic first pass: drop items with no text and no metrics, and exact-duplicate texts.
 * The LLM never sees what this removes.
 */
export function prefilter(items: FilterItem[]): { kept: FilterItem[]; dropped: Array<{ id: string; why: string }> } {
  const seen = new Set<string>()
  const kept: FilterItem[] = []
  const dropped: Array<{ id: string; why: string }> = []
  for (const it of items) {
    const text = it.text.trim()
    if (text.length < 12 && Object.keys(it.metrics).length === 0) {
      dropped.push({ id: it.id, why: 'empty' })
      continue
    }
    const key = createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ')).digest('hex')
    if (text.length >= 12 && seen.has(key)) {
      dropped.push({ id: it.id, why: 'duplicate' })
      continue
    }
    seen.add(key)
    kept.push(it)
  }
  return { kept, dropped }
}

const SYSTEM = `You are Argus's filter. For each Facebook item, decide whether it carries a REAL market signal for the
objective (a competitor offer or price, a demand signal, a complaint, a trend, an audience fact, notable engagement).
Discard noise: greetings, generic promotion with no offer, spam, off-topic. When you keep an item:
- summary: one factual sentence, no speculation
- numbers: only numbers that literally appear in the item text or its metrics (prices, counts, percentages), as numbers
- entities: brands, places, products named in the item
- reason: why it matters for the objective
Never invent numbers. Return JSON {"verdicts":[...]} with one verdict per input id.`

export async function filterBatch(
  objective: { title: string; description: string; signal_kinds: string[] },
  items: FilterItem[],
  opts: GeminiOptions = {},
): Promise<{ verdicts: FilterVerdict[]; tokens: number }> {
  if (items.length === 0) return { verdicts: [], tokens: 0 }
  const user = JSON.stringify({
    objective,
    items: items.map((i) => ({ id: i.id, source: i.source_name, kind: i.kind, text: i.text.slice(0, 1500), metrics: i.metrics, posted_at: i.posted_at })),
  })
  const { data, tokens } = await generateJson(SYSTEM, user, FilterResponse, opts)
  const ids = new Set(items.map((i) => i.id))
  const verdicts = data.verdicts.filter((v) => ids.has(v.id))
  return { verdicts: verdicts.map((v) => ({ ...v, numbers: keepGroundedNumbers(v.numbers, items.find((i) => i.id === v.id)!) })), tokens }
}

/** Drop any number the model reported that does not appear in the item text or metrics. */
export function keepGroundedNumbers(numbers: Record<string, number>, item: FilterItem): Record<string, number> {
  const haystack = new Set<number>(Object.values(item.metrics))
  for (const m of item.text.matchAll(/\d+(?:[.,]\d+)?/g)) haystack.add(Number(m[0].replace(',', '.')))
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(numbers)) if (haystack.has(v)) out[k] = v
  return out
}
