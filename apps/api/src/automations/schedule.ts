/**
 * Cron parsing — tz-aware. The dispatcher relies on this to compute
 * `next_run_at` correctly through DST transitions. NEVER do naive UTC
 * arithmetic on a cron string — DST will silently desync.
 *
 * See ARCHITECTURE_AUTOMATIONS.md §1.4: "Timezone is env-level, never
 * inferred from the browser."
 */
import cronParser from 'cron-parser';

export interface NextRunResult {
  next_run_at: Date;
  /** Pretty-printed for logs / API responses. */
  iso: string;
}

/**
 * Compute the next occurrence of `cron` in `tz`, starting from `from`
 * (defaults to now). Returns null if the cron is malformed.
 *
 * Uses cron-parser's IANA-tz support, which delegates to the host's tz
 * database. On Linux this is glibc's zoneinfo; on macOS, the system's
 * tzdata. Both handle DST correctly.
 */
export function nextRun(
  cron: string,
  tz: string,
  from: Date = new Date(),
): NextRunResult | null {
  try {
    const it = cronParser.parseExpression(cron, {
      tz,
      currentDate: from,
    });
    const date = it.next().toDate();
    return { next_run_at: date, iso: date.toISOString() };
  } catch {
    return null;
  }
}

/**
 * Return the next N occurrences of `cron` in `tz`. Used by the UI's
 * "next 3 runs" preview so the operator can sanity-check their schedule.
 */
export function nextNRuns(
  cron: string,
  tz: string,
  n: number,
  from: Date = new Date(),
): Date[] {
  try {
    const it = cronParser.parseExpression(cron, { tz, currentDate: from });
    const out: Date[] = [];
    for (let i = 0; i < n; i++) {
      out.push(it.next().toDate());
    }
    return out;
  } catch {
    return [];
  }
}

/** Cheap "is this cron parseable in this tz" check for save-time validation. */
export function isValidCron(cron: string, tz: string): boolean {
  try {
    cronParser.parseExpression(cron, { tz });
    return true;
  } catch {
    return false;
  }
}
