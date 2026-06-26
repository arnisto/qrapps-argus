/**
 * Redactor rules — the source of truth for what counts as sensitive.
 *
 * See docs/ARCHITECTURE_AUTOMATION_SAFETY.md §2.2 (bright line) and §3
 * (three labels: secret | pii | quasi-id | safe). These rules are the
 * runtime regex layer of the hybrid classifier:
 *
 *   1. NAME-based: matched against column names from information_schema
 *      and SQL SELECT-list projections. Catches `password_hash`, `email`,
 *      `customer_id` by column identifier alone.
 *
 *   2. VALUE-based: matched against actual cell values when:
 *        (a) a connector is enabled and we sample 25 rows per column at
 *            crawl time (catches a `notes` column that contains emails)
 *        (b) at runtime, for cells in still-unclassified columns
 *
 * The bright line — SECRET_NAME_REGEX — is enforced at THREE points
 * (compile time, runtime preflight, row-header check). It is
 * MODE-INDEPENDENT. Even raw-passthrough cannot bypass.
 *
 * Other labels (`pii`, `quasi-id`) drive the mask-sensitive vs.
 * aggregate-only mode behavior in redactor/index.ts.
 */

export type Label = 'safe' | 'pii' | 'quasi-id' | 'secret';

// ---------------------------------------------------------------------------
// THE bright line. No legitimate summary use; no consent can cure;
// breach-grade if leaked. Enforced regardless of redaction_mode.
// ---------------------------------------------------------------------------
export const SECRET_NAME_REGEX =
  /^(.*_)?(password|passwd|pwd|hash|token|api_key|apikey|secret|private_key|privkey|session_id|sessionid|session|mfa(_.*)?|otp(_.*)?)$/i;

/**
 * Same idea for cell-value scanning of model OUTPUT (the post-render leak
 * scan in §5). If the LLM summary literally contains a token-shaped
 * string, refuse to send. Matches common API-key / token shapes:
 *   - JWT (eyJ... eyJ... ...)
 *   - sk_/ak_/xoxb-/ghp_ prefixed secrets (Stripe, Argus, Slack, GitHub)
 *   - AWS access key (AKIA...)
 *   - generic base64-ish 32+ char tokens following a `token`/`key` literal
 */
export const OUTPUT_SECRET_VALUE_REGEX = new RegExp(
  [
    String.raw`eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}`, // JWT
    String.raw`\b(sk|ak|pk|xoxb|xoxa|ghp|gho|ghu|ghs)[_-][A-Za-z0-9_\-]{20,}\b`, // prefixed
    String.raw`\bAKIA[0-9A-Z]{16}\b`, // AWS access key
    String.raw`(?:(?:api[_\s]?key|token|secret|bearer)[\s:=]+["']?)[A-Za-z0-9_\-]{24,}["']?`,
  ].join('|'),
  'g',
);

// ---------------------------------------------------------------------------
// Column-name classifier. First match wins; order matters — secret first.
// ---------------------------------------------------------------------------
interface NameRule {
  label: Label;
  /** Tested against the lowercased column name (no schema/table prefix). */
  name_regex: RegExp;
}

export const NAME_RULES: NameRule[] = [
  // SECRET — the bright line. Always refused.
  { label: 'secret', name_regex: SECRET_NAME_REGEX },

  // PII — purpose-limitation under GDPR. Masked in mask-sensitive,
  // dropped in aggregate-only.
  { label: 'pii', name_regex: /^(.*_)?email(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(phone|mobile|tel|telephone|gsm|cin)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(first|last|full|given|family|middle)?_?name$/i },
  { label: 'pii', name_regex: /^(.*_)?(addr|address|street|postal_code|zip|postcode|city|country)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(dob|birth_date|birthdate|birthday|date_of_birth|age)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(ssn|nin|national_id|passport|nid|tin|cnss|cnam)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(iban|bic|swift|card_number|pan|cvv|account_number|routing)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(salary|wage|compensation|comp_band|comp_total|comp_base|bonus|payslip)(_.*)?$/i },
  { label: 'pii', name_regex: /^(.*_)?(geo_lat|geo_lng|latitude|longitude|gps_lat|gps_lon)(_.*)?$/i },

  // QUASI-IDENTIFIER — masked only in aggregate-only mode (re-id risk via
  // join across published reports).
  { label: 'quasi-id', name_regex: /^(.*_)?(user_id|customer_id|account_id|client_id|member_id|patient_id|employee_id)$/i },
  { label: 'quasi-id', name_regex: /^(.*_)?(device_id|fingerprint|udid|installation_id|machine_id)$/i },
  { label: 'quasi-id', name_regex: /^(.*_)?(ip|ip_address|ipv4|ipv6)$/i },
  { label: 'quasi-id', name_regex: /^(.*_)?(session_uuid|trace_id|request_id|correlation_id)$/i },
];

// ---------------------------------------------------------------------------
// Cell-value classifier. Used at crawl time (against 25 sample values per
// column) AND at runtime as the safety-net pass for unclassified columns.
// Conservative — false positives mask harmlessly; false negatives leak.
// ---------------------------------------------------------------------------
interface ValueRule {
  label: Label;
  /** Tested against a cell's stringified value, case-sensitive. */
  value_regex: RegExp;
}

export const VALUE_RULES: ValueRule[] = [
  // Secret-class values that should never appear in a non-credentials column.
  { label: 'secret', value_regex: /eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/ }, // JWT
  { label: 'secret', value_regex: /\b(sk|ak|pk|xoxb|xoxa|ghp|gho|ghu|ghs)[_-][A-Za-z0-9_\-]{20,}\b/ },
  { label: 'secret', value_regex: /\bAKIA[0-9A-Z]{16}\b/ },

  // PII-shaped values.
  { label: 'pii', value_regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/ }, // email
  { label: 'pii', value_regex: /\b(\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}\b/ }, // phone
  { label: 'pii', value_regex: /\b\d{3}[\s-]\d{2}[\s-]\d{4}\b/ }, // SSN (US shape)
  { label: 'pii', value_regex: /\b(TN|FR|DE|GB|ES|IT|BE|NL)\d{2}[\s]?[A-Z0-9]{4,30}\b/ }, // IBAN (EU/TN prefix)
  { label: 'pii', value_regex: /\b4\d{12}(\d{3})?\b/ }, // Visa
  { label: 'pii', value_regex: /\b5[1-5]\d{14}\b/ }, // MasterCard
];

/**
 * Classify a single column by name. Used at compile + preflight + connector
 * crawl. Falls through to `safe` if no rule matches — the operator override
 * + value-pass safety net catch the gaps later.
 */
export function classifyByName(columnName: string): Label {
  const name = columnName.trim();
  for (const rule of NAME_RULES) {
    if (rule.name_regex.test(name)) return rule.label;
  }
  return 'safe';
}

/**
 * Classify a single cell value. Used at crawl time (sample pass) and as
 * runtime safety net. Returns the highest-severity label any rule matches,
 * or `safe` if nothing matches.
 *
 * Order of severity (highest first): secret > pii > quasi-id > safe.
 */
export function classifyByValue(value: unknown): Label {
  if (value === null || value === undefined) return 'safe';
  const str = typeof value === 'string' ? value : String(value);
  let highest: Label = 'safe';
  for (const rule of VALUE_RULES) {
    if (!rule.value_regex.test(str)) continue;
    if (rule.label === 'secret') return 'secret';
    if (rule.label === 'pii' && (highest as Label) !== 'secret') highest = 'pii';
    if (rule.label === 'quasi-id' && highest === 'safe') highest = 'quasi-id';
  }
  return highest;
}

/**
 * Convenience: are any of the SELECT-list column names in the secret class?
 * Used by the compile-time validator + preflight check.
 */
export function findSecretColumns(columnNames: string[]): string[] {
  return columnNames.filter((n) => SECRET_NAME_REGEX.test(n));
}

/**
 * Convenience: which of the OUTPUT_SECRET_VALUE_REGEX matched in this text?
 * Used by the post-render leak scan in runner.ts. Returns the matched
 * substrings (de-duplicated) so the audit event can name them. Truncates
 * each match to 32 chars so we don't store the secret itself in the trace.
 */
export function scanOutputForSecretValues(text: string): string[] {
  if (!text) return [];
  const matches = new Set<string>();
  for (const m of text.matchAll(OUTPUT_SECRET_VALUE_REGEX)) {
    const head = m[0]?.slice(0, 32) ?? '';
    matches.add(`${head}…`);
    if (matches.size > 5) break; // bound the report
  }
  return Array.from(matches);
}
