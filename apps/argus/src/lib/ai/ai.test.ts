import { describe, expect, it } from 'vitest'
import { fakeGeminiFetch, generateJson, AiError } from './gemini'
import { ObjectiveProposal, defaultObjective, proposeObjective } from './propose-objective'
import { filterBatch, keepGroundedNumbers, prefilter, type FilterItem } from './filter-signals'
import { critic, numbersIn, renderMarkdown, type ReportSignal, type StructuredReport } from './report'
import { z } from 'zod'

const lovixa = { name: 'Lovixa', description: 'group planning app', country: 'TN', city: 'Tunis', sources: [] }

describe('generateJson', () => {
  it('retries once on non-JSON then succeeds', async () => {
    const { data } = await generateJson('s', 'u', z.object({ a: z.number() }), {
      apiKey: 'k',
      fetchImpl: fakeGeminiFetch('not json', { a: 1 }),
    })
    expect(data.a).toBe(1)
  })
  it('throws a schema error after two bad answers', async () => {
    await expect(
      generateJson('s', 'u', z.object({ a: z.number() }), { apiKey: 'k', fetchImpl: fakeGeminiFetch({ a: 'x' }) }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('proposeObjective', () => {
  it('falls back to the default objective when the AI answer is invalid', async () => {
    const r = await proposeObjective(lovixa, { apiKey: 'k', fetchImpl: fakeGeminiFetch({ nope: true }) })
    expect(r.by).toBe('default')
    expect(ObjectiveProposal.parse(r.proposal).title).toContain('Lovixa')
  })
  it('uses the AI proposal when valid', async () => {
    const proposal = { ...defaultObjective(lovixa), title: 'Watch padel and café offers in Tunis', ad_library_terms: ['padel tunis'] }
    const r = await proposeObjective(lovixa, { apiKey: 'k', fetchImpl: fakeGeminiFetch(proposal) })
    expect(r.by).toBe('ai')
    expect(r.proposal.ad_library_terms).toEqual(['padel tunis'])
  })
})

const item = (id: string, text: string, metrics: Record<string, number> = {}): FilterItem => ({
  id,
  source_name: 'Padel Arena',
  kind: 'post',
  text,
  metrics,
  posted_at: null,
})

describe('prefilter', () => {
  it('drops empty and duplicate items', () => {
    const r = prefilter([item('1', 'hi'), item('2', 'Padel 25 DT per person tonight'), item('3', 'padel 25 dt  per person TONIGHT')])
    expect(r.kept.map((i) => i.id)).toEqual(['2'])
    expect(r.dropped).toEqual([
      { id: '1', why: 'empty' },
      { id: '3', why: 'duplicate' },
    ])
  })
})

describe('filterBatch', () => {
  it('keeps only grounded numbers and ignores unknown ids', async () => {
    const items = [item('a', 'Padel 25 DT per person, 4 players', { reactions: 120 })]
    const fetchImpl = fakeGeminiFetch({
      verdicts: [
        { id: 'a', keep: true, importance: 4, kind: 'pricing', summary: 'Padel Arena sells padel at 25 DT per person', numbers: { price: 25, players: 4, invented: 99, reactions: 120 }, entities: ['Padel Arena'], reason: 'competitor price' },
        { id: 'ghost', keep: true, importance: 5, kind: 'trend', summary: 'x', numbers: {}, entities: [], reason: 'not in batch' },
      ],
    })
    const { verdicts } = await filterBatch({ title: 't', description: 'd', signal_kinds: ['pricing'] }, items, { apiKey: 'k', fetchImpl })
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]!.numbers).toEqual({ price: 25, players: 4, reactions: 120 })
  })
  it('keepGroundedNumbers reads decimal commas', () => {
    expect(keepGroundedNumbers({ p: 12.5 }, item('x', 'menu à 12,5 DT'))).toEqual({ p: 12.5 })
  })
})

const signals: ReportSignal[] = [
  { id: 's1', kind: 'pricing', summary: 'Padel Arena sells padel at 25 DT per person', numbers: { price: 25 }, entities: [], importance: 4, source_name: 'Padel Arena', created_at: '2026-11-03' },
  { id: 's2', kind: 'engagement', summary: 'Our page post got 120 reactions', numbers: { reactions: 120 }, entities: [], importance: 3, source_name: 'Lovixa', created_at: '2026-11-03' },
]
const good: StructuredReport = {
  title: 'Week of 3 November',
  summary: 'Competitors are pricing padel aggressively and our own posts are getting attention.',
  sections: [{ heading: 'Prices', claims: [{ text: 'Padel Arena charges 25 DT per person.', signal_ids: ['s1'] }] }],
  actions: [{ text: 'Post a group padel plan that beats 25 DT per head.', signal_ids: ['s1'] }],
}

describe('critic (the trust gate)', () => {
  it('passes a report whose numbers all come from cited signals', () => {
    expect(critic(good, signals)).toEqual([])
  })
  it('fails a planted wrong number (negative control)', () => {
    const bad = structuredClone(good)
    bad.sections[0]!.claims[0]!.text = 'Padel Arena charges 30 DT per person.'
    const problems = critic(bad, signals)
    expect(problems).toHaveLength(1)
    expect(problems[0]!.problem).toBe('ungrounded_number')
  })
  it('fails a number taken from a signal that is not cited', () => {
    const bad = structuredClone(good)
    bad.sections[0]!.claims[0]!.text = 'Our post got 120 reactions.'
    expect(critic(bad, signals)[0]!.problem).toBe('ungrounded_number')
  })
  it('fails an unknown signal id and a number in the summary', () => {
    const bad = structuredClone(good)
    bad.summary = 'Prices rose 10%.'
    bad.actions[0]!.signal_ids = ['nope']
    expect(critic(bad, signals).map((p) => p.problem).sort()).toEqual(['summary_has_number', 'unknown_signal'])
  })
  it('reads thousands separators and decimals', () => {
    expect(numbersIn('1,200 people, 12.5 DT, 1 200 views, 45%')).toEqual([1200, 12.5, 1200, 45])
    expect(numbersIn('between 25, 30 and 12,5 DT')).toEqual([25, 30, 12.5])
  })
  it('renders numbered citations and an evidence list', () => {
    const md = renderMarkdown(good, signals)
    expect(md).toContain('Padel Arena charges 25 DT per person. [1]')
    expect(md).toContain('## Evidence')
  })
})
