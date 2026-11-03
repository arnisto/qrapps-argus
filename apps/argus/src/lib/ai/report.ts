import { z } from 'zod'
import { generateJson, type GeminiOptions } from './gemini'

export interface ReportSignal {
  id: string
  kind: string
  summary: string
  numbers: Record<string, number>
  entities: string[]
  importance: number
  source_name: string
  created_at: string
}

const Claim = z.object({ text: z.string().min(3).max(500), signal_ids: z.array(z.string()).min(1).max(10) })
export const StructuredReport = z.object({
  title: z.string().min(3).max(140),
  summary: z.string().min(3).max(800),
  sections: z.array(z.object({ heading: z.string().min(2).max(80), claims: z.array(Claim).min(1).max(8) })).max(6),
  actions: z.array(Claim).max(5),
})
export type StructuredReport = z.infer<typeof StructuredReport>

const SYSTEM = `You are Argus. Write a short market report for a founder from the signals provided, and nothing else.
Rules: every claim cites the signal ids it rests on; every number you write must appear in a cited signal's numbers
(same value); no number may be computed, rounded or invented; if signals are thin, say so plainly. The summary
(no numbers) says what changed and why it matters. actions are up to 3 concrete next steps, each citing signals.
Return JSON only.`

export async function writeReport(
  ctx: { company: string; objective: string; period: string },
  signals: ReportSignal[],
  opts: GeminiOptions = {},
): Promise<{ report: StructuredReport; tokens: number }> {
  const user = JSON.stringify({
    ...ctx,
    signals: signals.map((s) => ({ id: s.id, kind: s.kind, importance: s.importance, source: s.source_name, summary: s.summary, numbers: s.numbers, entities: s.entities })),
    output_shape: { title: 'string', summary: 'string', sections: [{ heading: 'string', claims: [{ text: 'string', signal_ids: ['id'] }] }], actions: [{ text: 'string', signal_ids: ['id'] }] },
  })
  const { data, tokens } = await generateJson(SYSTEM, user, StructuredReport, { temperature: 0.3, ...opts })
  return { report: data, tokens }
}

export interface CriticProblem {
  claim: string
  problem: 'unknown_signal' | 'ungrounded_number' | 'summary_has_number'
  detail: string
}

/** Numbers as written in prose: 1 200, 1,200, 12.5, 45%. Years and ordinals are still numbers and still checked. */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  // Group 1: grouped thousands ("1,200", "1 200", "12 500.5"). Group 2: plain or decimal ("25", "12.5", "12,5").
  for (const m of text.matchAll(/(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?)(?!\d)|(\d+(?:[.,]\d+)?)/g)) {
    const normalized = m[1] ? m[1].replace(/[ ,]/g, '') : m[2]!.replace(',', '.')
    const n = Number(normalized)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * The trust gate. Deterministic, no LLM: every claim must cite known signals, and every number in a claim must
 * equal a number in one of its cited signals. A report with any problem is stored as `failed`, never shown as verified.
 */
export function critic(report: StructuredReport, signals: ReportSignal[]): CriticProblem[] {
  const byId = new Map(signals.map((s) => [s.id, s]))
  const problems: CriticProblem[] = []
  for (const n of numbersIn(report.summary)) {
    problems.push({ claim: report.summary, problem: 'summary_has_number', detail: `summary mentions ${n} without a citation` })
  }
  const claims = [...report.sections.flatMap((s) => s.claims), ...report.actions]
  for (const c of claims) {
    const cited = c.signal_ids.map((id) => byId.get(id))
    const missing = c.signal_ids.filter((_, i) => !cited[i])
    if (missing.length) {
      problems.push({ claim: c.text, problem: 'unknown_signal', detail: `cites unknown signal(s) ${missing.join(', ')}` })
      continue
    }
    const allowed = new Set(cited.flatMap((s) => Object.values(s!.numbers)))
    for (const n of numbersIn(c.text)) {
      if (!allowed.has(n)) problems.push({ claim: c.text, problem: 'ungrounded_number', detail: `${n} is not in the cited signals` })
    }
  }
  return problems
}

export function renderMarkdown(r: StructuredReport, signals: ReportSignal[]): string {
  const index = new Map(signals.map((s, i) => [s.id, i + 1]))
  const cite = (ids: string[]) => ids.map((id) => `[${index.get(id) ?? '?'}]`).join('')
  const lines: string[] = [`# ${r.title}`, '', r.summary, '']
  for (const s of r.sections) {
    lines.push(`## ${s.heading}`, '')
    for (const c of s.claims) lines.push(`- ${c.text} ${cite(c.signal_ids)}`)
    lines.push('')
  }
  if (r.actions.length) {
    lines.push('## What to do next', '')
    r.actions.forEach((a, i) => lines.push(`${i + 1}. ${a.text} ${cite(a.signal_ids)}`))
    lines.push('')
  }
  lines.push('## Evidence', '')
  signals.forEach((s, i) => lines.push(`${i + 1}. ${s.source_name}: ${s.summary}`))
  return lines.join('\n')
}
