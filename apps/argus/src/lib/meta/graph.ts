/**
 * Meta Graph API client: official endpoints only, no scraping.
 * - own pages: me/accounts -> page access token -> {page}/posts (+ comment and reaction counts)
 * - public competitor pages: {page}/posts with the app's Page Public Content Access feature (needs Meta App Review)
 * - Ad Library: ads_archive (needs the account owner's Meta identity verification)
 */
import { requireEnv } from '@/lib/env'
import type { FetchLike } from '@/lib/ai/gemini'

export const GRAPH_VERSION = 'v23.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

export const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'read_insights', 'ads_read']

export type MetaErrorKind = 'rate_limited' | 'auth' | 'permission' | 'not_found' | 'other'

export class MetaError extends Error {
  constructor(
    message: string,
    readonly kind: MetaErrorKind,
    readonly code: number | null,
  ) {
    super(message)
  }
}

/** Graph error codes: 4/17/32/613 rate limits, 190 bad token, 10/200-299 permissions, 100 + subcode 33 missing object. */
export function classifyMetaError(code: number | null, subcode: number | null): MetaErrorKind {
  if (code === null) return 'other'
  if ([4, 17, 32, 613, 80001, 80004].includes(code)) return 'rate_limited'
  if (code === 190 || code === 102) return 'auth'
  if (code === 10 || (code >= 200 && code <= 299)) return 'permission'
  if (code === 100 && subcode === 33) return 'not_found'
  return 'other'
}

export class GraphClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path.replace(/^\//, '')}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    // The token goes in a header, never in a URL that could end up in a log.
    const res = await this.fetchImpl(url.toString(), { headers: { authorization: `Bearer ${this.token}` } })
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || body.error) {
      const code = body.error?.code ?? null
      const kind = classifyMetaError(code, body.error?.error_subcode ?? null)
      throw new MetaError(body.error?.message ?? `Graph HTTP ${res.status}`, kind, code)
    }
    return body as T
  }

  /** Follow `paging.next` up to `maxPages`. Stops early when `stop(item)` returns true (cursor reached). */
  async paged<T>(path: string, params: Record<string, string>, maxPages = 3, stop?: (item: T) => boolean): Promise<T[]> {
    const out: T[] = []
    let page = await this.get<{ data: T[]; paging?: { next?: string } }>(path, params)
    for (let i = 0; ; i++) {
      for (const item of page.data ?? []) {
        if (stop?.(item)) return out
        out.push(item)
      }
      const next = page.paging?.next
      if (!next || i + 1 >= maxPages) return out
      page = await this.get(next)
    }
  }
}

// ---------------------------------------------------------------- OAuth

export function oauthDialogUrl(state: string): string {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', requireEnv('META_APP_ID'))
  url.searchParams.set('redirect_uri', requireEnv('META_REDIRECT_URI'))
  url.searchParams.set('state', state)
  url.searchParams.set('scope', META_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

/** Code -> short-lived token -> long-lived (~60 days) user token. */
export async function exchangeCode(code: string, fetchImpl: FetchLike = fetch): Promise<{ token: string; expiresAt: Date | null }> {
  const appId = requireEnv('META_APP_ID')
  const secret = requireEnv('META_APP_SECRET')
  const short = new URL(`${GRAPH}/oauth/access_token`)
  short.searchParams.set('client_id', appId)
  short.searchParams.set('client_secret', secret)
  short.searchParams.set('redirect_uri', requireEnv('META_REDIRECT_URI'))
  short.searchParams.set('code', code)
  const s = (await (await fetchImpl(short.toString(), {})).json()) as { access_token?: string; error?: { message?: string } }
  if (!s.access_token) throw new MetaError(s.error?.message ?? 'code exchange failed', 'auth', null)

  const long = new URL(`${GRAPH}/oauth/access_token`)
  long.searchParams.set('grant_type', 'fb_exchange_token')
  long.searchParams.set('client_id', appId)
  long.searchParams.set('client_secret', secret)
  long.searchParams.set('fb_exchange_token', s.access_token)
  const l = (await (await fetchImpl(long.toString(), {})).json()) as { access_token?: string; expires_in?: number }
  const token = l.access_token ?? s.access_token
  const expiresAt = l.expires_in ? new Date(Date.now() + l.expires_in * 1000) : null
  return { token, expiresAt }
}

// ---------------------------------------------------------------- data shapes

export interface MetaPage {
  id: string
  name: string
  access_token?: string
  category?: string
  fan_count?: number
}

export interface CollectedItem {
  external_id: string
  kind: 'post' | 'ad'
  text: string
  metrics: Record<string, number>
  url: string | null
  posted_at: string | null
  payload: unknown
}

interface GraphPost {
  id: string
  message?: string
  story?: string
  created_time?: string
  permalink_url?: string
  shares?: { count?: number }
  reactions?: { summary?: { total_count?: number } }
  comments?: { summary?: { total_count?: number } }
}

interface GraphAd {
  id: string
  page_name?: string
  ad_creative_bodies?: string[]
  ad_creative_link_titles?: string[]
  ad_delivery_start_time?: string
  ad_snapshot_url?: string
  publisher_platforms?: string[]
}

const POST_FIELDS = 'id,message,story,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)'

export function postToItem(p: GraphPost): CollectedItem {
  const metrics: Record<string, number> = {}
  if (p.reactions?.summary?.total_count !== undefined) metrics.reactions = p.reactions.summary.total_count
  if (p.comments?.summary?.total_count !== undefined) metrics.comments = p.comments.summary.total_count
  if (p.shares?.count !== undefined) metrics.shares = p.shares.count
  return {
    external_id: p.id,
    kind: 'post',
    text: p.message ?? p.story ?? '',
    metrics,
    url: p.permalink_url ?? null,
    posted_at: p.created_time ?? null,
    payload: p,
  }
}

export function adToItem(a: GraphAd): CollectedItem {
  const text = [a.page_name, ...(a.ad_creative_link_titles ?? []), ...(a.ad_creative_bodies ?? [])].filter(Boolean).join('\n')
  return {
    external_id: a.id,
    kind: 'ad',
    text,
    metrics: {},
    url: a.ad_snapshot_url ?? null,
    posted_at: a.ad_delivery_start_time ?? null,
    payload: a,
  }
}

export async function listPages(user: GraphClient): Promise<MetaPage[]> {
  return user.paged<MetaPage>('me/accounts', { fields: 'id,name,access_token,category,fan_count', limit: '50' }, 2)
}

/** Posts newer than `since` (exclusive), newest first, at most ~75. */
export async function pagePosts(client: GraphClient, pageId: string, since: Date | null): Promise<CollectedItem[]> {
  const params: Record<string, string> = { fields: POST_FIELDS, limit: '25' }
  if (since) params.since = String(Math.floor(since.getTime() / 1000) + 1)
  const posts = await client.paged<GraphPost>(`${pageId}/posts`, params, 3)
  return posts.map(postToItem)
}

/** Ads reaching `country` that match the search terms. Active and recently inactive, newest first. */
export async function adLibrary(client: GraphClient, terms: string, country: string): Promise<CollectedItem[]> {
  const ads = await client.paged<GraphAd>(
    'ads_archive',
    {
      search_terms: terms,
      ad_reached_countries: JSON.stringify([country]),
      ad_type: 'ALL',
      ad_active_status: 'ALL',
      fields: 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_snapshot_url,publisher_platforms',
      limit: '50',
    },
    2,
  )
  return ads.map(adToItem)
}

/** Accepts a numeric page id, a facebook.com/<name> URL, or a profile.php?id= URL. Returns the id or vanity name. */
export function parsePageRef(input: string): string | null {
  const s = input.trim()
  if (/^\d{5,}$/.test(s)) return s
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`)
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null
    const id = url.searchParams.get('id')
    if (url.pathname === '/profile.php' && id && /^\d+$/.test(id)) return id
    const first = url.pathname.split('/').filter(Boolean)[0]
    if (first && /^[A-Za-z0-9.\-]{3,}$/.test(first) && !['pages', 'groups', 'events', 'watch'].includes(first)) return first
  } catch {
    return null
  }
  return null
}
