/**
 * Password hashing — thin wrapper around bcrypt.
 *
 * 12 rounds is the 2026 sweet spot: ~250ms on a modern laptop. Anything below
 * 10 is too fast; anything above 14 starts to hurt login UX without
 * meaningfully changing the attacker math.
 */
import bcrypt from 'bcrypt';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
