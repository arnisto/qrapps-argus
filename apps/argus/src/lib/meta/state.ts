import { randomBytes, timingSafeEqual } from 'node:crypto'

export const META_STATE_COOKIE = 'argus_meta_state'

/** The OAuth `state` ties the callback to the browser that started it and to one company. */
export function newState(companySlug: string): { state: string; cookie: string } {
  const state = randomBytes(24).toString('base64url')
  return { state, cookie: `${state}.${companySlug}` }
}

export function checkState(cookie: string | undefined, state: string | null): { ok: true; companySlug: string } | { ok: false } {
  if (!cookie || !state) return { ok: false }
  const dot = cookie.indexOf('.')
  if (dot < 0) return { ok: false }
  const expected = Buffer.from(cookie.slice(0, dot))
  const given = Buffer.from(state)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false }
  return { ok: true, companySlug: cookie.slice(dot + 1) }
}
