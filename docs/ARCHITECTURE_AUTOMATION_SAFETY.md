# Automation Safety — outbound leak prevention (M9)

> **The product loop**: an operator writes *"every day, summarise yesterday's new users and post to Slack #growth."* Argus today will happily pull `(id, email, name, phone, password_hash, ssn, …)` from the customer's Postgres, summarise it via Gemini, and post the result to a Slack channel — where it sits in Slack's search index forever, readable by anyone with channel membership.
>
> This document is the spec for M9 — the safety floor that closes that leak surface. Two independent advisors (`legal-compliance` + `principal-engineer`) reviewed the proposal in parallel; their decisions converged on every load-bearing point and are codified below.

**Status**: spec — implementation lands in M9.1 / M9.2 / M9.3 per §11.

---

## 1 · The leak surface today (the pipeline as written)

| Stage | File / line | Leak mechanism | Mitigation |
|---|---|---|---|
| **SQL emission** | `compiler.ts:387` `isReadOnlyStatement` | LLM emits `SELECT *` or names a refused column | Compile-time AST guard (§6) |
| **SQL execution** | `db-query.ts:138` `client.query(sql)` | Validated SQL can still return PII columns the operator hasn't classified | Run-time SELECT-list rewrite via parsed AST (§3) |
| **Row serialisation** | `db-query.ts:52` `rowsToText` — header is `Object.keys(rows[0])` | Whatever the DB returned becomes LLM input verbatim | Redactor wraps `rowsToText` (§3) |
| **LLM input** | `runner.ts:158` `chatComplete(...)` | Redacted-but-still-suggestive text reaches Gemini/Groq in a foreign region | `provider_region_pref` routing (§9) |
| **LLM output** | `runner.ts:165` `summaryText` | Model may quote raw PII, hallucinate values, or echo prompt-injected exfil | Per-mode system prompt (§5) + post-render scan against secret regex |
| **Channel send** | `runner.ts:191` `dispatchSend → slack.send` | Lands in a Slack workspace in a non-EU region | Operator-acknowledged region banner (§8); retention sweeper (M9.3) |
| **Audit/log** | `runner.ts:170,177,196` `trace.push({ sql, rows_returned })` + `automation_runs.output_text` | `step_trace` stores raw SQL; `output_text` is the unredacted summary | Two-tier storage: `automation_runs.output_text` purged on `output_retention_days`; immutable `audit_events` stores plan hash + mode + acks, never rendered text (§7) |
| **Preview path** | `runner.ts:180` `sendEnabled=false` | Preview still calls `chatComplete` — PII leaves DB → Gemini even on preview | Redactor runs on the preview path too (no bypass) |

The fix is layered. No single change closes the surface; the redactor + per-mode prompt + audit log + region selector together do.

---

## 2 · The four load-bearing decisions

### 2.1 Three redaction modes, operator picks per automation

| Mode | What it does | When to use | Required acks |
|---|---|---|---|
| **`mask-sensitive`** (default) | Column-name + regex classifier strips identifiers / PII; rewrites SQL SELECT list to exclude refused columns; remaining `pii`-labelled column values get `<email#1>`, `<phone#2>` token replacement (per-column, per-run, never persisted) | Safe baseline for any summary against a DB with PII columns | Standard 5-tick checklist |
| **`aggregate-only`** | Same as mask-sensitive PLUS the compiler rejects any SQL that isn't a `GROUP BY` / aggregate query (no per-row data ever leaves) | Channels with broad audience (`#all-company`); data you can't fully classify | Standard 5-tick checklist |
| **`raw-passthrough`** | No masking. No SQL rewrite | Trusted DB with no PII; the operator has lawful basis + DPA + restricted channel | Standard 5-tick PLUS explicit `"raw_passthrough_acknowledged": true`, actor + timestamp written to audit log |

Choice surfaced at automation creation time. Default is `mask-sensitive` — operators who want less safety must explicitly opt down.

### 2.2 ONE hardcoded bright-line refusal: credentials & secrets

```ts
// apps/api/src/automations/redactor/rules.ts
export const SECRET_NAME_REGEX = /^(.*_)?(password|passwd|pwd|hash|token|api_key|apikey|secret|private_key|privkey|session_id|sessionid|session|mfa(_.*)?|otp(_.*)?)$/i;
```

Columns matching this regex are **never sendable**, regardless of redaction mode, regardless of operator override, regardless of acknowledgment. Enforced at THREE points (defence in depth):

1. **Compile time** (`compiler.ts:validate` via AST walk of SELECT list) — fatal error in the editor: *"Refused: column `users.password_hash` is classified secret."*
2. **Preflight** (right before `runQueryViaConnector`, every run including preview) — second AST walk; match → `status='suppressed'`, `error_class='refused_column'`. Catches automations compiled before a column was classified.
3. **Row header check** in `rowsToText` — header name match → run aborts; redactor never even runs. Belt + braces.

Mode-independent. Even `raw-passthrough` cannot bypass.

**Why ONE bright line, not more**: the right shape per legal-compliance brief §7. Operators in healthcare/HR have legitimate Art. 9(2) bases for special-category data; hardcoding a refusal there would block lawful use. Credentials/secrets have no legitimate summary use — breach-grade leak with no upside.

### 2.3 Postgres = schedule + safety truth; runtime enforces

The same separation that M8 made for scheduling (Postgres = truth, BullMQ = execution) applies here: Postgres holds the `column_classifications` table + the `audit_events` immutable log. The runtime reads classifications, enforces modes, writes audit events. **The runtime never decides policy** — it only enforces what's in the DB.

### 2.4 Region is per-automation; fail-clean, never silent downgrade

The render step today calls Gemini Flash (US) or Groq fallback (US). For an EU operator processing EU-subject rows, that's a cross-border transfer requiring SCCs at minimum. For a Tunisia operator, INPDP prior authorization (Tunisia Law 2004-63 Art. 52 is *stricter* than GDPR — no SCC shortcut).

**Per-automation `provider_region_pref` ∈ `{eu, us, any}`**:
- `any` (default): existing order
- `eu`: filter providers `WHERE region='eu'`; if none → **fail the run cleanly**, `error_class='no_provider_in_region'`. NEVER silently downgrade to US.
- `us`: same fail-clean for `region='us'`.

EU render path lands as `apps/api/src/llm/mistral.ts` — Mistral La Plateforme (`mistral-small-latest`, EU-hosted), mirroring the existing `gemini.ts` interface.

---

## 3 · The classifier — hybrid (a)+(b)+(d)

**Pick**: runtime regex + crawl-time sample-based + operator override.

**Why not (e) operator-only**: trust-by-default for a customer connecting a 200-table Postgres and forgetting to label is a footgun that fires silently.

**Why not Microsoft Presidio**: heavy Python dep, non-English false positives, runtime cost we'd pay every send. Wrong v1 trade.

### Three labels

| Label | Examples | Treatment |
|---|---|---|
| `secret` | `password_hash`, `api_key`, `session_token` | Refused, all modes (§2.2) |
| `pii` | `email`, `phone`, `name`, `address`, `dob` | Masked in `mask-sensitive`; dropped in `aggregate-only`; passed in `raw-passthrough` |
| `quasi-id` | `customer_id`, `device_id`, `ip_address` | Masked in `aggregate-only` only (re-identification risk via join) |
| `safe` | numeric counts, timestamps, enum values | Untouched |

### How a column gets a label

1. **Runtime regex** (cheap, always-on, transparent): `rules.ts` exports `CLASSIFY_RULES: Array<{label, name_regex, value_regex?}>`. Applied to every SELECT-list column at compile + preflight.
2. **Crawl-time sample** at connector enable: walks `information_schema.columns`, pulls 25 sample values per column, runs `value_regex` pass, persists `{column_name, detected_label, sample_confidence, source: 'auto'}` to `column_classifications`. Operator sees this on a per-connector "Privacy" tab.
3. **Operator override**: same table, `source: 'operator'`. Overrides win over `auto`.
4. **Runtime value-pass safety net**: for cells in unclassified columns, scan values against `value_regex` of known PII labels. If a cell matches, mask it AND log a `pii_discovered_at_runtime` audit event so the operator can promote the column.

**Pressure-test**: *"what about a `bio` column with an email in 1 of 25 sample rows?"* → crawl-time sample misses it. Defence-in-depth: runtime value pass catches it on the cell. Slow but bounded by `row_cap=100`.

---

## 4 · Where the redactor lives — SQL rewrite + cell-value masking

**Decision**: rewrite the SELECT list at compile time + mask remaining cell values at `rowsToText`. NOT "in the SELECT in the customer's DB via projection rules" — pushes policy where the operator can't audit it.

New module `apps/api/src/automations/redactor/index.ts`:

```ts
// Rewrites SELECT to drop/replace refused or PII columns per mode.
// Returns the safe SQL + diagnostics for the audit log.
rewriteSelectList(sql, classifications, mode): {
  sql: string;             // the rewritten SQL to execute
  dropped: string[];       // columns removed entirely
  replaced: string[];      // columns replaced with literal-token projections
  refused: string[];       // secret columns — throws RefusedColumnError if non-empty
}

// Second pass on rowsToText output — catches values that slipped through
// (e.g. an email in a `notes` free-text column).
maskRowsText(rowsText, classifications, mode): string;
```

**Tokenisation**: stable **per-column, per-run** — `<email#1>`, `<email#2>` reset every run. NOT stable across runs (correlation attack surface). Counter persisted nowhere — lives in runner memory for the duration of one run.

**Call site**:
```ts
// runner.ts after line 131:
const safeSQL = rewriteSelectList(plan.read.sql_template, classifications, automation.redaction_mode);
const rowsResult = await runQueryViaConnector(envId, plan.read.connector_id, safeSQL.sql);
rowsResult.rows_text = maskRowsText(rowsResult.rows_text, classifications, automation.redaction_mode);
// then proceed to render as today
```

---

## 5 · Per-mode render prompt — replace single `RENDER_SYSTEM`

The current `RENDER_SYSTEM` in `runner.ts:65` says *"cite specific numbers from the data"* — this actively works against safety. Replace with `RENDER_SYSTEM_BY_MODE: Record<RedactionMode, string>`:

**`mask-sensitive`** (default):
> *"You are summarising data that has been pre-redacted. Placeholders like `<email#1>`, `<phone#2>` are intentional — they hide real values from you. DO NOT invent values to replace them. DO NOT echo placeholders verbatim — describe categorically ('one customer email was logged'). Cite aggregate numbers (counts, sums) freely. NEVER quote any string that looks like an email, phone, name, address, or token. If the only interesting fact is a redacted value, say 'one user matched this criterion' without naming them."*

**`aggregate-only`**:
> Above PLUS *"You will only see aggregate rows (counts, sums, averages). If you see anything that looks like a per-row identifier, that's a bug — refuse and say so."*

**`raw-passthrough`**:
> The current prompt. Loaded only when `automation.acknowledged_at IS NOT NULL` and ack-payload includes `"raw_passthrough_acknowledged": true`.

### Post-render defence-in-depth

After `chatComplete` returns, run the `SECRET_NAME_REGEX` from §2.2 over `summaryText`. If it matches, fail the run with `error_class='leak_detected_in_output'`. Never send. Audit event written.

---

## 6 · Compile-time guards — `node-sql-parser`

**Pick**: `node-sql-parser`. Pure JS, supports PG dialect, AST is the data structure the redactor already needs. `pg-query-emscripten` is a 4MB WASM blob (overkill). `libpg_query` is the right answer when we eventually move parsing into a Rust sidecar — not v1.

Replace `isReadOnlyStatement` with `validateSafeSql(sql, classifications, mode)`:

1. Parse to AST. Reject anything that isn't a single `SELECT`/`WITH`/`EXPLAIN`.
2. Reject `SELECT *` in `mask-sensitive` and `aggregate-only`. Allowed in `raw-passthrough` (with ack).
3. Walk SELECT-list columns. Look up `column_classifications`:
   - `secret`-label → **fatal**: `errors.push('Refused: column <x.y> is classified secret')`
   - `pii` in `aggregate-only` → fatal
   - Unclassified column → warning
4. In `aggregate-only`, require every projection is an aggregate (`count/sum/avg/min/max/array_agg(distinct …)`) or a `GROUP BY` key. Otherwise fatal.
5. Refused-token check on raw SQL bytes too — catches CTEs / subqueries the parser might miss.

---

## 7 · Audit log shape

A new immutable `audit_events` table separate from `automation_runs` because:
- `automation_runs.output_text` gets purged on retention
- `audit_events` outlive runs and must be retained ≥ 12 months (regulatory baseline)

```sql
CREATE TABLE audit_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id        UUID NOT NULL,
  env_id        UUID NOT NULL,
  actor_user_id UUID,
  automation_id UUID,
  run_id        UUID,
  event_type    TEXT NOT NULL,
  plan_hash     TEXT,
  redaction_mode TEXT,
  provider      TEXT,
  provider_region TEXT,
  ack_payload   JSONB,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb
);
```

**Append-only enforcement** via triggers (Postgres has no native primitive):

```sql
CREATE FUNCTION audit_events_no_modify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
-- application PG role gets INSERT, SELECT only; no UPDATE/DELETE/TRUNCATE.
```

### Events written

| When | `event_type` | `payload` |
|---|---|---|
| Compile | `automation.compiled` | `{warnings, errors}` |
| Operator activates | `automation.activated` | `{checklist ticks: 5}` |
| Operator pauses | `automation.paused` | `{reason}` |
| Run starts | `run.started` | `{trigger}` |
| Run completes | `run.completed` | `{status, tokens, refused_columns[], masked_columns[], leak_detected: bool}` |
| Run suppressed | `run.suppressed` | `{reason, e.g. refused_column / budget_daily / leak_detected_in_output}` |
| Output purged | `output_text.purged` | `{run_id, retention_days}` |
| Slack message deleted (M9.3) | `channel.message.deleted` | `{external_id}` |

**Never logged**: raw row content, summary text, secret values. The audit log is the evidence, not the leak.

---

## 8 · Pre-activation checklist — 5 ticks

Stored in `automations.acknowledgements` JSONB:

```json
{
  "no_secrets_in_query":     {"at": "ISO", "by": "<uuid>"},
  "redaction_mode_chosen":   {"at": "ISO", "by": "<uuid>", "mode": "mask-sensitive"},
  "region_acknowledged":     {"at": "ISO", "by": "<uuid>", "region": "us"},
  "retention_acknowledged":  {"at": "ISO", "by": "<uuid>", "days": 30},
  "channel_audience_confirmed":{"at": "ISO", "by": "<uuid>", "channel": "#leadership"}
}
```

**Re-triggered when**: `plan_hash` changes. Implementation: on save, recompute `sha256(canonical(compiled_plan + redaction_mode + send.channel))`. If `plan_hash` changed, `UPDATE automations SET acknowledgements='{}'::jsonb, acknowledged_at=NULL, status='draft'`. Activation requires all 5 ticks present AND `plan_hash` matches stored.

Triggers on: prompt edit, channel change, model change, redaction_mode change, recompile.

---

## 9 · Right-to-erasure surface

When a data subject erases their account at the source, residue exists in THREE places:

1. **Source DB** — operator handles, outside Argus.
2. **Argus's own store** — `automation_runs.output_text` persists indefinitely today. M9.1 adds per-automation `output_retention_days` (default 30, range 1-365) + nightly purge job: `UPDATE automation_runs SET output_text = NULL WHERE finished_at < now() - automation.output_retention_days * interval '1 day'`. Audit event written per purge. **Row not deleted** — kept for the audit cross-ref; only `output_text` is nulled.
3. **Slack channel history** — Argus cannot delete posts at scale. The `send` step already returns `external_id = channel:ts`. **M9.3** ships a sweeper using `chat.delete` against stored `ts` values, gated on `output_retention_days`. Operator's choice.

---

## 10 · Schema delta — `0011_automation_safety.sql`

```sql
-- Per-automation safety knobs.
ALTER TABLE automations
  ADD COLUMN redaction_mode      TEXT NOT NULL DEFAULT 'mask-sensitive'
    CHECK (redaction_mode IN ('mask-sensitive', 'aggregate-only', 'raw-passthrough')),
  ADD COLUMN provider_region_pref TEXT NOT NULL DEFAULT 'any'
    CHECK (provider_region_pref IN ('eu', 'us', 'any')),
  ADD COLUMN output_retention_days INT NOT NULL DEFAULT 30
    CHECK (output_retention_days BETWEEN 1 AND 365),
  ADD COLUMN acknowledged_at      TIMESTAMPTZ,
  ADD COLUMN acknowledged_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN acknowledgements     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN plan_hash            TEXT;

-- Provider region — needed by §9 routing.
ALTER TABLE providers
  ADD COLUMN region TEXT CHECK (region IN ('eu', 'us', 'other'));

-- Column classifications (separate table, NOT JSONB on env_connectors —
-- per-row updates, queryable in the redactor hot path).
CREATE TABLE column_classifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id  UUID NOT NULL REFERENCES env_connectors(id) ON DELETE CASCADE,
  schema_name   TEXT NOT NULL,
  table_name    TEXT NOT NULL,
  column_name   TEXT NOT NULL,
  label         TEXT NOT NULL CHECK (label IN ('safe', 'pii', 'quasi-id', 'secret')),
  source        TEXT NOT NULL CHECK (source IN ('auto', 'operator')),
  sample_confidence NUMERIC(4, 3),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connector_id, schema_name, table_name, column_name)
);
CREATE INDEX column_classifications_conn_label_idx
  ON column_classifications (connector_id, label);

-- Immutable audit log (see §7).
CREATE TABLE audit_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id        UUID NOT NULL,
  env_id        UUID NOT NULL,
  actor_user_id UUID,
  automation_id UUID,
  run_id        UUID,
  event_type    TEXT NOT NULL,
  plan_hash     TEXT,
  redaction_mode TEXT,
  provider      TEXT,
  provider_region TEXT,
  ack_payload   JSONB,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_env_idx ON audit_events (env_id, occurred_at DESC);

-- Append-only enforcement.
CREATE FUNCTION audit_events_no_modify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_modify();
```

---

## 11 · Build order

### M9.1 — the actual safety floor (ships first)

- Migration `0011_automation_safety.sql`
- `apps/api/src/automations/redactor/{rules.ts, index.ts, classify.ts}` — the three classifier paths + SQL rewriter + cell-value masker
- `SECRET_NAME_REGEX` enforcement at compile + preflight + row-header check (§2.2 — all three points)
- `column_classifications` table + crawl-time sample on connector enable (READ-ONLY for operator, no UI yet)
- `mask-sensitive` mode + `rewriteSelectList` + `maskRowsText` (NO `aggregate-only` yet)
- `RENDER_SYSTEM_BY_MODE` for `mask-sensitive` + post-render leak scan
- `audit_events` table + triggers + writes on compile/activate/run-complete/suppressed
- Nightly cron: nulls `automation_runs.output_text` past `output_retention_days`

**With these four, the §1 leak surface is CLOSED.** Everything else is policy refinement.

### M9.2

- `aggregate-only` mode + AST aggregate validator
- Pre-activation checklist UI + `acknowledgements` JSONB persistence + `plan_hash` invalidation
- Operator override UI on per-connector "Privacy" tab
- Region selector + Mistral EU provider + EU routing fail-clean

### M9.3

- Slack delete sweeper via stored `external_id`
- Tunisia-env banner (UI only; data already in `audit_events`)
- `raw-passthrough` mode unlocked (gated on ack)
- Audit export endpoint for regulators

---

## 12 · What M9 refuses to build

- ❌ **Customer-supplied bright-line refusal rules.** Argus owns `SECRET_NAME_REGEX`. Operators label individual columns; they cannot contract or extend the refusal list. Bright lines stay bright.
- ❌ **Per-row authorisation / row-level policies.** That's a year-long data-masking-governance project. M9 redacts at *column* granularity only.
- ❌ **Bidirectional tokenisation** ("redact then ask the LLM to un-redact for trusted recipients"). The foot-gun that defeats the whole exercise.
- ❌ **Outbound DLP beyond the regex post-render scan**. Presidio-grade scanning is M11+ if ever.
- ❌ **Multi-region failover within a run**. Pick a region, succeed or fail-clean. Half-EU-half-US runs are non-auditable.
- ❌ **Retro-classification of historical `automation_runs.output_text`.** New runs only; legacy stays in place until retention purge sweeps it.
- ❌ **Auto-recompile on schema drift**. Same M8 rule: operator clicks Recompile. Schema change re-triggers the checklist.

---

## 13 · Cross-references — files that change

| File | Change |
|---|---|
| `apps/api/src/automations/runner.ts` | Splice redactor between read (131) and render (156); load per-mode prompt at 159; post-render scan after 165; route via region pref at 152 |
| `apps/api/src/automations/compiler.ts` | Replace `isReadOnlyStatement` with AST-based `validateSafeSql` at 387; load `column_classifications` |
| `apps/api/src/agent/db-query.ts` | `rowsToText` (52) gains column-header refusal check; accepts rewritten SQL |
| `apps/api/src/automations/redactor/` (new) | `rules.ts`, `index.ts`, `classify.ts` |
| `apps/api/src/llm/mistral.ts` (new) | EU render path mirroring `gemini.ts` interface |
| `apps/api/src/connectors/adapters/slack.ts` | Add `deleteMessage(channel, ts)` for M9.3 sweeper |
| `docker/postgres/migrations/0011_automation_safety.sql` (new) | §10 schema delta |

---

## 14 · Disclaimer

This document is a technical-leaning baseline. The `legal-compliance` advisor explicitly noted: **"I am not a lawyer."** Every "must" here is the floor for the engineering spec; every customer-facing legal claim (privacy notice copy, ROPA wording, DPA references) needs sign-off from real counsel before publication. Operators are the data controllers; Argus is the software they configure. The product's job is to make the safe choices easy and the unsafe choices loud — not to substitute for legal review.

---

## 15 · Summary

The leak surface is named (§1), the four load-bearing decisions are codified (§2), the classifier is hybrid (§3), the redactor lives at SQL-rewrite + cell-value-mask boundaries (§4), per-mode render prompts replace the one that today encourages verbatim citation (§5), compile-time validation gets an AST upgrade (§6), audit events are append-only via Postgres triggers (§7), the 5-tick activation checklist is gated on `plan_hash` (§8), erasure has three surfaces with per-automation `output_retention_days` (§9), the schema delta is one migration file (§10), and the build splits cleanly into three M9 sub-pushes (§11).

**M9.1 is the smallest set that closes the leak.** Everything past M9.1 is policy refinement and operator UX. Implementation green-light required before code lands.
