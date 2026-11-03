import { describe, expect, it } from 'vitest'
import { GraphClient, MetaError, adToItem, classifyMetaError, parsePageRef, postToItem } from './graph'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('classifyMetaError', () => {
  it('maps the documented codes', () => {
    expect(classifyMetaError(32, null)).toBe('rate_limited')
    expect(classifyMetaError(613, null)).toBe('rate_limited')
    expect(classifyMetaError(190, 463)).toBe('auth')
    expect(classifyMetaError(10, null)).toBe('permission')
    expect(classifyMetaError(100, 33)).toBe('not_found')
    expect(classifyMetaError(1, null)).toBe('other')
  })
})

describe('GraphClient', () => {
  it('sends the token as a header, not in the URL', async () => {
    let seen = ''
    let auth = ''
    const client = new GraphClient('TOKEN', async (url, init) => {
      seen = url
      auth = new Headers(init.headers).get('authorization') ?? ''
      return json({ data: [] })
    })
    await client.get('me/accounts', { fields: 'id' })
    expect(seen).not.toContain('TOKEN')
    expect(auth).toBe('Bearer TOKEN')
  })
  it('throws a typed rate-limit error', async () => {
    const client = new GraphClient('t', async () => json({ error: { message: 'limit', code: 32 } }, 400))
    const err = await client.get('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MetaError)
    expect((err as MetaError).kind).toBe('rate_limited')
  })
  it('follows paging.next up to maxPages', async () => {
    let calls = 0
    const client = new GraphClient('t', async () => {
      calls++
      return json({ data: [{ id: String(calls) }], paging: { next: `https://graph.facebook.com/next?p=${calls}` } })
    })
    const items = await client.paged<{ id: string }>('x', {}, 3)
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3'])
    expect(calls).toBe(3)
  })
  it('strips access_token from paging URLs (negative control for token-in-URL)', async () => {
    const urls: string[] = []
    const client = new GraphClient('t', async (url) => {
      urls.push(url)
      return json({ data: [{ id: 'x' }], paging: urls.length === 1 ? { next: 'https://graph.facebook.com/v23.0/p/posts?access_token=SECRET&after=abc' } : {} })
    })
    await client.paged('p/posts', {}, 3)
    expect(urls).toHaveLength(2)
    expect(urls[1]).not.toContain('SECRET')
    expect(urls[1]).toContain('after=abc')
  })
})

describe('mappers', () => {
  it('maps a post with counts', () => {
    const item = postToItem({
      id: 'p1',
      message: 'Padel 25 DT',
      created_time: '2026-11-01T10:00:00+0000',
      reactions: { summary: { total_count: 120 } },
      comments: { summary: { total_count: 8 } },
      shares: { count: 3 },
    })
    expect(item.metrics).toEqual({ reactions: 120, comments: 8, shares: 3 })
    expect(item.text).toBe('Padel 25 DT')
  })
  it('maps an ad into one text block', () => {
    const item = adToItem({ id: 'a1', page_name: 'Padel Arena', ad_creative_bodies: ['-20% ce weekend'] })
    expect(item.text).toBe('Padel Arena\n-20% ce weekend')
    expect(item.kind).toBe('ad')
  })
})

describe('parsePageRef', () => {
  it('accepts ids, vanity URLs and profile.php URLs', () => {
    expect(parsePageRef('123456789')).toBe('123456789')
    expect(parsePageRef('https://www.facebook.com/PadelArenaTunis/')).toBe('PadelArenaTunis')
    expect(parsePageRef('facebook.com/profile.php?id=1000123')).toBe('1000123')
  })
  it('rejects other hosts and non-page paths', () => {
    expect(parsePageRef('https://evil.com/PadelArena')).toBeNull()
    expect(parsePageRef('https://facebook.com/groups/abc')).toBeNull()
  })
})
