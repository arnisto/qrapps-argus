/**
 * AES-256-GCM for third-party tokens at rest (Meta user tokens). Adapted from the pre-v1 Argus secret helper
 * without the on-disk key bootstrap: on Vercel the filesystem is ephemeral, so a generated key would orphan every
 * stored token on the next cold start. APP_SECRET is required.
 *
 * Wire format: separate ciphertext (auth tag appended) and 12-byte nonce, stored as `token_ct` / `token_iv`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const AUTH_TAG_LEN = 16

export function loadKey(secret = process.env.APP_SECRET): Buffer {
  if (!secret) throw new Error('APP_SECRET is required (base64, 32 bytes): openssl rand -base64 32')
  const key = Buffer.from(secret, 'base64')
  if (key.length !== 32) throw new Error('APP_SECRET must decode to exactly 32 bytes')
  return key
}

export function encrypt(plaintext: string, key = loadKey()): { ct: Buffer; iv: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { ct, iv }
}

export function decrypt(ct: Buffer, iv: Buffer, key = loadKey()): string {
  const tag = ct.subarray(ct.length - AUTH_TAG_LEN)
  const body = ct.subarray(0, ct.length - AUTH_TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/** Postgres `bytea` round-trips through PostgREST as `\x...` hex strings. */
export function toHex(b: Buffer): string {
  return '\\x' + b.toString('hex')
}
export function fromHex(s: string): Buffer {
  return Buffer.from(s.startsWith('\\x') ? s.slice(2) : s, 'hex')
}
