import { describe, expect, it } from 'vitest'
import { checkState, newState } from './state'

describe('meta oauth state', () => {
  it('accepts the state it issued and returns the company', () => {
    const { state, cookie } = newState('lovixa')
    expect(checkState(cookie, state)).toEqual({ ok: true, companySlug: 'lovixa' })
  })
  it('rejects a forged or missing state (negative control)', () => {
    const { cookie } = newState('lovixa')
    expect(checkState(cookie, 'forged').ok).toBe(false)
    expect(checkState(undefined, 'x').ok).toBe(false)
    expect(checkState(cookie, null).ok).toBe(false)
  })
})
