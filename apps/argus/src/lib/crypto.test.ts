import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, fromHex, loadKey, toHex } from './crypto'

const KEY = Buffer.alloc(32, 7).toString('base64')

describe('crypto', () => {
  it('round-trips a token', () => {
    const key = loadKey(KEY)
    const { ct, iv } = encrypt('EAAB-long-lived-token', key)
    expect(decrypt(ct, iv, key)).toBe('EAAB-long-lived-token')
  })
  it('round-trips through the bytea hex form', () => {
    const key = loadKey(KEY)
    const { ct, iv } = encrypt('x', key)
    expect(decrypt(fromHex(toHex(ct)), fromHex(toHex(iv)), key)).toBe('x')
  })
  it('refuses a tampered ciphertext (negative control)', () => {
    const key = loadKey(KEY)
    const { ct, iv } = encrypt('secret', key)
    ct[0] = ct[0]! ^ 0xff
    expect(() => decrypt(ct, iv, key)).toThrow()
  })
  it('refuses a missing or short key', () => {
    expect(() => loadKey(undefined)).toThrow(/APP_SECRET/)
    expect(() => loadKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/)
  })
})
