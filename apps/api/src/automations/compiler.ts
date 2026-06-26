/**
 * Automation compiler — M8.2.
 *
 * Turns one natural-language sentence:
 *
 *   "every Monday 9am Tunis time, pull last week's order totals from
 *    Postgres acme-prod and post a summary to Slack #leadership"
 *
 * into a deterministic structured plan:
 *
 *   {
 *     name, schedule_cron, schedule_tz,
 *     plan: {
 *       read:   { connector_id, sql_template, row_cap },
 *       render: { model, user_template },
 *       send:   { connector_id, channel, format }
 *     }
 *   }
 *
 * Then VALIDATES it: connectors exist, SQL passes read-only safety,
 * send.connector is kind='channel', cron is parseable. Validation
 * errors are returned as { warnings, errors } so the UI can surface
 * them BEFORE the operator clicks Activate.
 *
 * The plan is then frozen onto `automations.compiled_plan`. Re-compile
 * is an explicit operator action — never automatic.
 *
 * Same JSON-output approach as the SQL planner (M7.4): strict JSON from
 * the LLM, parse + re-prompt once on failure.
 */
import cronParser from 'cron-parser';
import { db } from '../db.js';
import { chatComplete } from '../llm/router.js';
import { loadProviderForEnv } from '../routes/providers.js';
import type { ProviderRow, OpenAIMessage } from '../llm/gemini.js';
import { SECRET_NAME_REGEX } from './redactor/rules.js';

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export interface CompiledPlan {
  /** UUID of the connector to read from. */
  read: {
    connector_id: string;
    connector_subtype: string;
    sql_template: string;
    row_cap: number;
  };
  render: {
    /** Provider model id, e.g. 'gemini-2.5-flash'. */
    model: string;
    /** The summarisation prompt. `{{rows}}` gets replaced with the
     *  formatted query result at run-time. */
    user_template: string;
  };
  send: {
    connector_id: string;
    connector_subtype: string;
    channel: string;
    /** 'text' for plain message, 'blocks' for Block-Kit rich card. */
    format: 'text' | 'blocks';
  };
}

export interface CompileResult {
  ok: boolean;
  /** Frozen plan to persist on `automations.compiled_plan`. */
  plan: CompiledPlan | null;
  /** Suggested name (operator can override before save). */
  name: string;
  /** Cron in UTC IANA form. May be null if the user's prompt was
   *  ambiguous about timing — UI prompts for a structured picker. */
  schedule_cron: string | null;
  /** IANA timezone. Defaults to the env's tz if the user didn't say. */
  schedule_tz: string;
  /** Non-fatal — plan is still usable but flagged for the UI. */
  warnings: string[];
  /** Fatal — plan is null and the operator must fix the prompt. */
  errors: string[];
  /** Which model compiled the plan, persisted on the row for audit. */
  compiler_model: string;
}

// ---------------------------------------------------------------------------
// LLM prompt
// ---------------------------------------------------------------------------

const COMPILER_SYSTEM = `You are the Argus Automation Compiler. Your job is to translate a single English sentence describing a scheduled task into a structured JSON plan.

The plan has FOUR parts:
  - name           : a short label, ≤80 chars, derived from the task
  - schedule_cron  : a 5-field cron expression (e.g. "0 9 * * 1" for "every Monday 9am")
  - schedule_tz    : IANA timezone string (e.g. "Africa/Tunis", "UTC")
  - plan.read      : which connector to query + the SQL to run
  - plan.render    : which LLM model summarises the rows + the summarisation prompt
  - plan.send      : which channel-kind connector receives the summary + its target channel + format

REPLY RULES (very important):
  - Output ONLY valid JSON. No markdown fences, no prose before or after.
  - Use this exact shape:
    {
      "name": "string",
      "schedule_cron": "string",
      "schedule_tz": "string",
      "plan": {
        "read":   { "connector_id": "...", "connector_subtype": "...", "sql_template": "...", "row_cap": 100 },
        "render": { "model": "...", "user_template": "..." },
        "send":   { "connector_id": "...", "connector_subtype": "...", "channel": "...", "format": "text" | "blocks" }
      }
    }
  - If you cannot determine a field, set it to null. The plan-level fields (read/render/send) must each be an object — never null at that level — but their inner fields may be null.

SQL RULES:
  - Only SELECT / WITH / EXPLAIN. Never INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/GRANT.
  - No semicolons.
  - Always include LIMIT unless it is a pure aggregate.
  - Only reference tables/columns visible in the connector's known schema.
  - Prefer aggregates over raw row dumps.

CONNECTOR RULES:
  - read.connector_id MUST be one of the listed db-kind connectors.
  - send.connector_id MUST be one of the listed channel-kind connectors.
  - If the user names a connector by name (e.g. "acme-prod"), match by name.
  - If the user just says "Postgres" / "Slack" and there is exactly one of that subtype, use it.
  - If ambiguous (multiple Postgres connectors, no name given), set read.connector_id to null and the caller will surface the choice to the operator.

SCHEDULE RULES:
  - Always use UTC as schedule_tz if the user did not name a timezone.
  - "Tunis time" → "Africa/Tunis". "Paris" → "Europe/Paris". "EST" → "America/New_York". "PT" → "America/Los_Angeles". When in doubt, prefer the IANA name not the abbreviation.
  - Default schedule_cron to "0 9 * * *" (daily 9am) if the user said "daily" without specifying a time.

MODEL RULES:
  - Default render.model to "gemini-2.5-flash" — fast, cheap, structured-output capable.
  - Use the same model unless the user explicitly named a different one.

RENDER TEMPLATE RULES:
  - The user_template will receive the query result as the variable {{rows}}.
  - Write a clear, terse summarisation instruction. Mention the audience if implied.
  - Example: "Summarise last week's order data for the #leadership channel. Lead with the most interesting trend, cite specific numbers. Data:\\n{{rows}}"

If the user's request is too vague to compile at all, return all top-level fields as null EXCEPT name (give your best guess) and include the reason in the absent fields' null-ness.`;

const SCHEMA_LIST_LIMIT = 30; // chunks of schema text to expose to the compiler

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function compileAutomation(
  envId: string,
  envSlug: string,
  promptText: string,
  envTz: string,
): Promise<CompileResult> {
  // 1. List available connectors for this env. The compiler can only
  //    reference these — anything else is a hallucination we must catch
  //    in validation.
  const connectors = await listEnvConnectors(envId);

  // 2. Fetch a sampling of the env's db_schema chunks so the compiler can
  //    write SQL that references real tables. Without this it would
  //    invent table names.
  const schemaText = await sampleSchemaChunks(envId);

  // 3. Compile via the env's primary provider (whichever model is
  //    connected first — typically Gemini).
  const { provider, model } = await pickCompilerProvider(envId);

  const userMessage = buildUserMessage(promptText, connectors, schemaText, envTz);
  const messages: OpenAIMessage[] = [
    { role: 'system', content: COMPILER_SYSTEM },
    { role: 'user', content: userMessage },
  ];

  let raw: string;
  try {
    const resp = await chatComplete(provider, model, messages, {
      temperature: 0,
      max_tokens: 2048,
    });
    raw = resp.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    return failed(
      `LLM call failed: ${(err as Error).message}`,
      `Compiler model ${model} on ${envSlug}`,
      envTz,
    );
  }

  let parsed = tryParse(raw);
  if (!parsed) {
    // Re-prompt once. Same approach as the SQL planner (M7.4).
    try {
      const resp = await chatComplete(
        provider,
        model,
        [
          ...messages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content:
              'That was not valid JSON. Reply ONLY with valid JSON in the schema described — no fences, no prose.',
          },
        ],
        { temperature: 0, max_tokens: 2048 },
      );
      parsed = tryParse(resp.choices?.[0]?.message?.content?.trim() ?? '');
    } catch {
      // fall through
    }
  }

  if (!parsed) {
    return failed('Compiler returned unparseable output', model, envTz);
  }

  return validate(parsed, connectors, model, envTz);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ConnectorSummary {
  id: string;
  kind: string;
  subtype: string;
  name: string;
}

async function listEnvConnectors(envId: string): Promise<ConnectorSummary[]> {
  const { rows } = await db().query<ConnectorSummary>(
    `SELECT id, kind, subtype, name FROM env_connectors
       WHERE env_id = $1 AND enabled
       ORDER BY created_at`,
    [envId],
  );
  return rows;
}

async function sampleSchemaChunks(envId: string): Promise<string> {
  // Pull up to N db_schema chunk titles. The compiler doesn't need the
  // full DDL; just enough to know what tables exist.
  const { rows } = await db().query<{ title: string; text: string }>(
    `SELECT s.title, substring(c.text from 1 for 400) AS text
       FROM sources s JOIN chunks c ON c.source_id = s.id
      WHERE s.env_id = $1 AND s.kind = 'db_schema'
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [envId, SCHEMA_LIST_LIMIT],
  );
  if (rows.length === 0) return '(no schema known for this env yet — operator should connect a Postgres connector first)';
  return rows.map((r) => `# ${r.title}\n${r.text}`).join('\n\n');
}

async function pickCompilerProvider(envId: string): Promise<{
  provider: ProviderRow;
  model: string;
}> {
  // Prefer Gemini for the compiler. Free-tier, structured-output-friendly,
  // and the embeddings already go through it so the key is already configured.
  // The providers schema stores the subtype in `name` and the model in
  // `default_model`.
  const { rows } = await db().query<{ id: string; name: string; default_model: string }>(
    `SELECT id, name, default_model FROM providers
      WHERE env_id = $1 AND enabled
      ORDER BY (name = 'gemini') DESC, created_at
      LIMIT 1`,
    [envId],
  );
  if (!rows[0]) {
    throw new Error('no_provider_connected — connect a model on /models first');
  }
  const provider = await loadProviderForEnv(envId, rows[0].name as 'gemini' | 'groq');
  if (!provider) {
    throw new Error(`provider ${rows[0].name} couldn't load`);
  }
  return { provider, model: rows[0].default_model };
}

function buildUserMessage(
  promptText: string,
  connectors: ConnectorSummary[],
  schemaText: string,
  envTz: string,
): string {
  const connList = connectors.length
    ? connectors
        .map(
          (c) =>
            `  - { id: "${c.id}", kind: "${c.kind}", subtype: "${c.subtype}", name: "${c.name}" }`,
        )
        .join('\n')
    : '  (no connectors connected — the operator must connect a db-kind read source and a channel-kind send target first)';

  return `USER REQUEST:
${promptText}

ENV CONFIG:
  default_timezone: ${envTz}

AVAILABLE CONNECTORS:
${connList}

KNOWN SCHEMA (from connected db connectors):
${schemaText}`;
}

function tryParse(text: string): unknown | null {
  if (!text) return null;
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Validation — the load-bearing safety pass
// ---------------------------------------------------------------------------

function validate(
  raw: unknown,
  connectors: ConnectorSummary[],
  compilerModel: string,
  envTz: string,
): CompileResult {
  if (!raw || typeof raw !== 'object') {
    return failed('Compiler returned non-object', compilerModel, envTz);
  }
  const r = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const errors: string[] = [];

  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'New automation';
  const scheduleCron = typeof r.schedule_cron === 'string' ? r.schedule_cron.trim() : null;
  const scheduleTz = typeof r.schedule_tz === 'string' ? r.schedule_tz.trim() : envTz;
  const planObj = (r.plan ?? {}) as Record<string, unknown>;
  const readObj = (planObj.read ?? {}) as Record<string, unknown>;
  const renderObj = (planObj.render ?? {}) as Record<string, unknown>;
  const sendObj = (planObj.send ?? {}) as Record<string, unknown>;

  // ---- Schedule validation ----
  if (scheduleCron) {
    try {
      cronParser.parseExpression(scheduleCron, { tz: scheduleTz });
    } catch (err) {
      errors.push(
        `Schedule could not be parsed as a cron expression in timezone ${scheduleTz}: ${(err as Error).message}. Try editing the schedule manually.`,
      );
    }
  } else {
    warnings.push(
      'Schedule was ambiguous — pick when the automation should run before activating.',
    );
  }

  // ---- Read connector validation ----
  const readConnId = typeof readObj.connector_id === 'string' ? readObj.connector_id : null;
  const readConn = readConnId ? connectors.find((c) => c.id === readConnId) : null;
  if (!readConn) {
    errors.push(
      "Couldn't identify which connector to read from. Either name it explicitly (e.g. 'from postgres acme-prod') or connect a Postgres connector first.",
    );
  } else if (readConn.kind !== 'db') {
    errors.push(
      `read.connector_id points to ${readConn.subtype} (kind=${readConn.kind}) — needs a db-kind connector.`,
    );
  }

  const sqlTemplate = typeof readObj.sql_template === 'string' ? readObj.sql_template.trim() : '';
  if (!sqlTemplate) {
    errors.push(
      "Couldn't draft the SELECT to run. Be more specific about what data Argus should pull (e.g. 'last week's order totals').",
    );
  } else if (!isReadOnlyStatement(sqlTemplate)) {
    errors.push(
      `Generated SQL is not a single SELECT/WITH/EXPLAIN — refusing to schedule a destructive query. Got: ${sqlTemplate.slice(0, 80)}…`,
    );
  } else {
    // M9.1 bright-line check #1 (compile time). Bytewise refusal — catches
    // password_hash, api_key, session_token etc. even when they hide in
    // CTEs / subqueries / joins the AST might not surface as projections.
    // Mode-independent: even raw-passthrough cannot bypass this.
    const secrets = findSecretByteMatchesInSQL(sqlTemplate);
    if (secrets.length > 0) {
      errors.push(
        `Refused: SQL references column(s) that match the secret bright line — ${secrets.join(', ')}. Credentials/tokens/hashes cannot be sent through Argus.`,
      );
    }
  }

  const rowCapRaw = readObj.row_cap;
  const rowCap = typeof rowCapRaw === 'number' && rowCapRaw > 0 && rowCapRaw <= 1000
    ? Math.floor(rowCapRaw)
    : 100;

  // ---- Render validation ----
  const model = typeof renderObj.model === 'string' && renderObj.model
    ? renderObj.model
    : 'gemini-2.5-flash';
  const userTemplate = typeof renderObj.user_template === 'string'
    ? renderObj.user_template.trim()
    : '';
  if (!userTemplate) {
    warnings.push(
      'No summarisation instruction was drafted. Argus will use a generic "summarise these rows" prompt.',
    );
  } else if (!userTemplate.includes('{{rows}}')) {
    warnings.push(
      "Summarisation template doesn't reference {{rows}} — the query result will be appended automatically.",
    );
  }

  // ---- Send validation ----
  const sendConnId = typeof sendObj.connector_id === 'string' ? sendObj.connector_id : null;
  const sendConn = sendConnId ? connectors.find((c) => c.id === sendConnId) : null;
  if (!sendConn) {
    errors.push(
      "Couldn't identify which channel to post to. Either name it explicitly (e.g. 'to slack #leadership') or connect a Slack connector first.",
    );
  } else if (sendConn.kind !== 'channel') {
    errors.push(
      `send.connector_id points to ${sendConn.subtype} (kind=${sendConn.kind}) — needs a channel-kind connector.`,
    );
  }

  const channel = typeof sendObj.channel === 'string' ? sendObj.channel.trim() : '';
  if (!channel) {
    warnings.push("No channel was specified — Argus will use the connector's default channel.");
  }

  const format =
    sendObj.format === 'blocks' || sendObj.format === 'text' ? sendObj.format : 'blocks';

  if (errors.length > 0) {
    return {
      ok: false,
      plan: null,
      name,
      schedule_cron: scheduleCron,
      schedule_tz: scheduleTz,
      warnings,
      errors,
      compiler_model: compilerModel,
    };
  }

  // All errors are caught — at this point readConn + sendConn are not null
  // (errors array would have been populated otherwise).
  const plan: CompiledPlan = {
    read: {
      connector_id: readConn!.id,
      connector_subtype: readConn!.subtype,
      sql_template: sqlTemplate,
      row_cap: rowCap,
    },
    render: {
      model,
      user_template: userTemplate || `Summarise these rows clearly and concisely. Data:\n{{rows}}`,
    },
    send: {
      connector_id: sendConn!.id,
      connector_subtype: sendConn!.subtype,
      channel: channel || '',
      format,
    },
  };

  return {
    ok: true,
    plan,
    name,
    schedule_cron: scheduleCron,
    schedule_tz: scheduleTz,
    warnings,
    errors: [],
    compiler_model: compilerModel,
  };
}

/**
 * M9.1 — bright-line byte scan. Catches secret-class column names anywhere
 * in the SQL (CTEs, subqueries, joins, function args) — not just in the
 * top-level SELECT list. Returns the matched identifiers.
 */
function findSecretByteMatchesInSQL(sql: string): string[] {
  const seen = new Set<string>();
  const ident = /\b([a-z_][a-z0-9_]*)\b/gi;
  for (const m of sql.matchAll(ident)) {
    const name = m[1]!;
    if (SECRET_NAME_REGEX.test(name)) seen.add(name);
  }
  return Array.from(seen);
}

function isReadOnlyStatement(sql: string): boolean {
  const trimmed = sql.replace(/\s+/g, ' ').trim();
  const withoutTrailing = trimmed.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) return false;
  const head = withoutTrailing.slice(0, 12).toUpperCase();
  return (
    head.startsWith('SELECT ') ||
    head.startsWith('SELECT(') ||
    head.startsWith('WITH ') ||
    head.startsWith('EXPLAIN ')
  );
}

function failed(reason: string, model: string, envTz: string): CompileResult {
  return {
    ok: false,
    plan: null,
    name: 'New automation',
    schedule_cron: null,
    schedule_tz: envTz,
    warnings: [],
    errors: [reason],
    compiler_model: model,
  };
}
