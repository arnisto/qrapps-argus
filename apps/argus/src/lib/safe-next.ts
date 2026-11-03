/** Only same-origin relative paths may be used as a post-login bounce target. */
export function safeNext(next: string | null | undefined, fallback = '/companies'): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
