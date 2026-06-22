/**
 * AES-GCM encryption for provider API keys at rest.
 *
 * APP_SECRET is a base64-encoded 32-byte key. If unset on first use, we
 * generate one and persist it at `~/.argus/secret` with mode 0o600, then
 * warn — production should always set APP_SECRET via env so the secret
 * doesn't live on disk.
 *
 * Wire format: separate ciphertext + 12-byte nonce columns (api_key_ct,
 * api_key_iv) — cleaner than the Python MVP's combined-string approach
 * and lines up 1:1 with the schema in migration 0007.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

const ALGO = 'aes-256-gcm';
const AUTH_TAG_LEN = 16;

let _cached: Buffer | null = null;

function loadKey(): Buffer {
  if (_cached) return _cached;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    try {
      const b = Buffer.from(fromEnv, 'base64');
      if (b.length === 32) {
        _cached = b;
        return b;
      }
    } catch {
      // fallthrough to disk / generate
    }
  }
  const path = join(homedir(), '.argus', 'secret');
  if (existsSync(path)) {
    try {
      const b = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
      if (b.length === 32) {
        _cached = b;
        return b;
      }
    } catch {
      // fallthrough to generate
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fresh = randomBytes(32);
  writeFileSync(path, fresh.toString('base64'));
  chmodSync(path, 0o600);
  // eslint-disable-next-line no-console
  console.warn(
    `[llm.secret] generated APP_SECRET at ${path}. ` +
      `Set APP_SECRET env in production so the key doesn't live on disk.`,
  );
  _cached = fresh;
  return fresh;
}

export interface Encrypted {
  ct: Buffer;
  iv: Buffer;
}

export function encryptKey(plaintext: string): Encrypted {
  if (!plaintext) return { ct: Buffer.alloc(0), iv: Buffer.alloc(0) };
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store ct||tag together so decrypt has everything it needs from one column.
  return { ct: Buffer.concat([ct, tag]), iv };
}

export function decryptKey(enc: Encrypted): string {
  if (!enc.ct.length) return '';
  const key = loadKey();
  const body = enc.ct.subarray(0, enc.ct.length - AUTH_TAG_LEN);
  const tag = enc.ct.subarray(enc.ct.length - AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, enc.iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
