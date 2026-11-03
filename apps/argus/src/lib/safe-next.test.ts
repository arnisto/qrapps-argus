import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  it('keeps a relative path', () => {
    expect(safeNext('/c/lovixa?x=1')).toBe('/c/lovixa?x=1')
  })
  it('rejects absolute and protocol-relative targets', () => {
    expect(safeNext('https://evil.example')).toBe('/companies')
    expect(safeNext('//evil.example')).toBe('/companies')
    expect(safeNext('/\\evil.example')).toBe('/companies')
    expect(safeNext(null)).toBe('/companies')
  })
})
