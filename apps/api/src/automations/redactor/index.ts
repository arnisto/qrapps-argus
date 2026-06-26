/**
 * Redactor — the safety layer between the customer DB and the LLM.
 *
 * Two complementary defenses (defence in depth):
 *
 *   1. SQL REWRITE (compile/preflight time) — parses the SELECT, looks up
 *      every projected column in `column_classifications`, and either:
 *        · refuses the run (secret-class column appears in projection)
 *        · drops the column (aggregate-only mode + pii column)
 *        · projects a literal token in place (mask-sensitive + pii column)
 *      Returns the safe SQL to actually execute.
 *
 *   2. CELL VALUE MASKING (runtime, on rowsText) — catches anything that
 *      slipped through #1: aliased columns, subquery projections,
 *      free-text columns containing emails ("notes" field with PII).
 *      Replaces matched cell values with stable per-run tokens like
 *      `<email#1>`, `<phone#2>`.
 *
 * See docs/ARCHITECTURE_AUTOMATION_SAFETY.md §3 (placement) and §4 (modes).
 *
 * Tokens are stable PER-COLUMN PER-RUN, NEVER across runs. That's a
 * deliberate choice — cross-run stability would let an attacker correlate
 * the same person across multiple summaries.
 */
// node-sql-parser is a CJS module; ESM-import the default and pluck Parser.
import nodeSqlParser from 'node-sql-parser';
const { Parser } = nodeSqlParser;
import { classifyByValue, VALUE_RULES, SECRET_NAME_REGEX, type Label } from './rules.js';
import type { ClassificationMap } from './classify.js';

export type RedactionMode = 'mask-sensitive' | 'aggregate-only' | 'raw-passthrough';

export interface RewriteResult {
  /** SQL to actually execute against the customer DB. May differ from input. */
  sql: string;
  /** Columns dropped entirely (mode='aggregate-only', label='pii'). */
  dropped: string[];
  /** Columns replaced with literal-token projections (mask-sensitive). */
  replaced: string[];
  /** Columns whose presence forces RefusedColumnError (any mode). */
  refused: string[];
  /** Did we touch the SQL at all? Used by audit_events. */
  changed: boolean;
}

export class RefusedColumnError extends Error {
  readonly refused: string[];
  constructor(refused: string[]) {
    super(`Refused: column(s) classified as secret cannot be sent: ${refused.join(', ')}`);
    this.refused = refused;
    this.name = 'RefusedColumnError';
  }
}

const parser = new Parser();

/**
 * Rewrite a SELECT to be safe under the given mode. Throws RefusedColumnError
 * if a secret-class column is projected (any mode, mode-independent rule).
 *
 * For mask-sensitive: pii/quasi-id columns are replaced with literal tokens
 * (`'<email>'::text AS email`) so the round-trip column shape is preserved
 * but the value never leaves the DB layer.
 *
 * For aggregate-only: pii/quasi-id columns are dropped from the SELECT
 * entirely. If that empties the projection, the run is refused.
 *
 * For raw-passthrough: only the secret refusal applies; everything else
 * passes through unchanged.
 */
export function rewriteSelectList(
  sql: string,
  classifications: ClassificationMap,
  mode: RedactionMode,
): RewriteResult {
  const result: RewriteResult = {
    sql,
    dropped: [],
    replaced: [],
    refused: [],
    changed: false,
  };

  // ------------------------------------------------------------------
  // Surface guard before AST: catch SELECT-* in safe modes + bytes match
  // on SECRET_NAME_REGEX (CTEs/subqueries the parser may flatten).
  // ------------------------------------------------------------------
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) {
    throw new Error('SQL contains multiple statements — redactor refuses.');
  }
  if ((mode === 'mask-sensitive' || mode === 'aggregate-only') && /\bselect\s+\*/i.test(trimmed)) {
    throw new Error(`SELECT * is forbidden in '${mode}' mode — name the columns explicitly.`);
  }

  // Refused-token byte scan. Catches password_hash, api_key etc. anywhere
  // in the SQL (including CTEs, joins) even if the parser doesn't surface
  // them as projections.
  const bytewise = findSecretByteMatches(trimmed);
  if (bytewise.length > 0) {
    result.refused = bytewise;
    throw new RefusedColumnError(bytewise);
  }

  // ------------------------------------------------------------------
  // Parse to AST. We don't try to handle every PG-specific construct;
  // when the parser doesn't understand the SQL, we fall back to the
  // surface guard (which has already passed for the common bad cases).
  // ------------------------------------------------------------------
  let ast: unknown;
  try {
    ast = parser.astify(trimmed, { database: 'postgresql' });
  } catch {
    // Parser couldn't handle this SQL. Bytes already passed the secret
    // refusal, so we let it through in raw-passthrough mode and refuse
    // in stricter modes (we can't enforce mask-sensitive without AST).
    if (mode === 'raw-passthrough') {
      result.sql = trimmed;
      return result;
    }
    throw new Error(
      "SQL couldn't be parsed for safety analysis — switch to a simpler SELECT or use raw-passthrough mode (requires explicit acknowledgement).",
    );
  }

  if (Array.isArray(ast)) ast = ast[0];
  if (!ast || typeof ast !== 'object') {
    throw new Error('Empty AST — refusing to execute.');
  }

  // Only SELECT-shaped queries are accepted here (preflight already filtered).
  type AstNode = Record<string, unknown>;
  const node = ast as AstNode;
  if (node.type !== 'select') {
    // WITH or EXPLAIN — fall back to raw byte check (already passed).
    result.sql = trimmed;
    return result;
  }

  // ------------------------------------------------------------------
  // Walk the SELECT list. For each projection:
  //   - secret label  → push to refused, throw
  //   - pii/quasi-id  → mode-specific rewrite (drop or mask)
  //   - safe          → leave alone
  // ------------------------------------------------------------------
  const columns = node.columns as Array<AstNode> | undefined;
  if (!columns || !Array.isArray(columns)) {
    result.sql = trimmed;
    return result;
  }

  const refused: string[] = [];
  const dropped: string[] = [];
  const replaced: string[] = [];
  const keptColumns: AstNode[] = [];

  for (const col of columns) {
    const projInfo = describeProjection(col);
    if (projInfo === null) {
      // Couldn't analyse (e.g. expression, function call) — keep as-is.
      keptColumns.push(col);
      continue;
    }
    const lbl = classifications.label(projInfo.schema, projInfo.table, projInfo.name);
    if (lbl === 'secret') {
      refused.push(qualified(projInfo));
      continue;
    }
    if (lbl === 'safe') {
      keptColumns.push(col);
      continue;
    }

    // pii or quasi-id from here on.
    const shouldDrop =
      mode === 'aggregate-only' || (mode === 'mask-sensitive' && lbl === 'pii');
    const shouldMask = mode === 'mask-sensitive' && lbl === 'quasi-id';
    const shouldPass = mode === 'raw-passthrough';

    if (shouldPass) {
      keptColumns.push(col);
    } else if (shouldDrop) {
      dropped.push(qualified(projInfo));
    } else if (shouldMask) {
      // Replace with a literal projection: 'redacted'::text AS <alias>
      const alias = projInfo.alias ?? projInfo.name;
      keptColumns.push(literalProjection(alias, `<${lbl}>`));
      replaced.push(qualified(projInfo));
    } else {
      keptColumns.push(col);
    }
  }

  if (refused.length > 0) {
    result.refused = refused;
    throw new RefusedColumnError(refused);
  }

  if (keptColumns.length === 0) {
    throw new Error(
      `${mode} mode dropped every column from the projection — query produces nothing safe to summarise.`,
    );
  }

  // If nothing changed, emit the original SQL byte-for-byte (preserves
  // operator-authored hints, comments, etc.).
  if (dropped.length === 0 && replaced.length === 0) {
    result.sql = trimmed;
    return result;
  }

  node.columns = keptColumns;
  try {
    // node-sql-parser's sqlify accepts an AST or AST[]; cast loosely since
    // we walked the AST ourselves above and trust the shape.
    result.sql = parser.sqlify(ast as Parameters<typeof parser.sqlify>[0], { database: 'postgresql' });
    result.dropped = dropped;
    result.replaced = replaced;
    result.changed = true;
    return result;
  } catch (err) {
    throw new Error(`Failed to serialize rewritten SQL: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers for the AST walk.
// ---------------------------------------------------------------------------

interface ProjectionInfo {
  schema: string | null;
  table: string | null;
  name: string;
  alias: string | null;
}

function describeProjection(col: Record<string, unknown>): ProjectionInfo | null {
  const expr = col.expr as Record<string, unknown> | undefined;
  if (!expr) return null;
  // Column reference: { type: 'column_ref', table: 'users', column: 'email' }
  if (expr.type === 'column_ref') {
    const column = expr.column;
    if (typeof column !== 'string') return null;
    const table = typeof expr.table === 'string' ? expr.table : null;
    const schema = typeof expr.schema === 'string' ? (expr.schema as string) : null;
    const alias = typeof col.as === 'string' ? col.as : null;
    return { schema, table, name: column, alias };
  }
  return null;
}

function qualified(p: ProjectionInfo): string {
  const parts = [p.schema, p.table, p.name].filter(Boolean) as string[];
  return parts.join('.') || p.name;
}

function literalProjection(alias: string, value: string): Record<string, unknown> {
  return {
    expr: {
      type: 'cast',
      keyword: 'cast',
      expr: { type: 'single_quote_string', value },
      symbol: '::',
      target: [{ dataType: 'TEXT' }],
    },
    as: alias,
  };
}

function findSecretByteMatches(sql: string): string[] {
  // Match identifier-ish tokens, test each against SECRET_NAME_REGEX.
  // This is BYTEWISE so it catches CTE projections, joined tables, etc.
  // that the parser may not surface in `columns`.
  const seen = new Set<string>();
  const ident = /\b([a-z_][a-z0-9_]*)\b/gi;
  for (const m of sql.matchAll(ident)) {
    const name = m[1]!;
    if (SECRET_NAME_REGEX.test(name)) seen.add(name);
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Cell-value masking — the runtime safety net.
// ---------------------------------------------------------------------------

export interface MaskResult {
  /** The rewritten rowsText to pass to the LLM. */
  rows_text: string;
  /** How many cells got replaced, by label. For the audit event. */
  masked_counts: Record<Label, number>;
  /** How many distinct values per label (tokens minted). */
  tokens_minted: Record<Label, number>;
}

/**
 * Walk every cell in the tab-separated rowsText (from db-query.rowsToText)
 * and replace any value matching a VALUE_RULE with a stable per-run token.
 *
 * Tokens are PER-LABEL PER-VALUE for THIS run: the same email appearing
 * 5 times in the rows gets the same `<email#1>` token; a different email
 * gets `<email#2>`. Counter resets every call (never persisted).
 *
 * In raw-passthrough mode: no-op, returns rowsText untouched (the caller
 * is responsible for the ack gate).
 */
export function maskRowsText(rowsText: string, mode: RedactionMode): MaskResult {
  const result: MaskResult = {
    rows_text: rowsText,
    masked_counts: { safe: 0, 'quasi-id': 0, pii: 0, secret: 0 },
    tokens_minted: { safe: 0, 'quasi-id': 0, pii: 0, secret: 0 },
  };
  if (mode === 'raw-passthrough') return result;
  if (!rowsText) return result;

  // Per-label, per-distinct-value token counter.
  const tokenIndex = new Map<string, string>(); // "label|value" → "<label#N>"
  const labelCounter = { safe: 0, 'quasi-id': 0, pii: 0, secret: 0 } as Record<Label, number>;

  const masked = rowsText.replace(/[^\t\n]+/g, (cell) => {
    const lbl = classifyByValue(cell);
    if (lbl === 'safe') return cell;

    // Secret in the OUTPUT is always refused — the run should NEVER post.
    // We mask aggressively here too, but the post-render scan (rules.ts:
    // scanOutputForSecretValues) is the load-bearing gate.
    result.masked_counts[lbl] += 1;
    const key = `${lbl}|${cell}`;
    const existing = tokenIndex.get(key);
    if (existing) return existing;
    labelCounter[lbl] += 1;
    result.tokens_minted[lbl] += 1;
    const token = `<${lbl}#${labelCounter[lbl]}>`;
    tokenIndex.set(key, token);
    return token;
  });

  result.rows_text = masked;
  return result;
}

// Re-export rules so callers have one place to import from.
export { SECRET_NAME_REGEX, OUTPUT_SECRET_VALUE_REGEX, scanOutputForSecretValues } from './rules.js';
export type { ColumnClassification, ClassificationMap } from './classify.js';
export { loadClassificationsForConnector, crawlClassifyConnector } from './classify.js';
