# Knowledge intake — architecture

> **The product thesis**: Argus stops being a vending machine and becomes the
> *company brain*. The brain has to be filled. Fast. The four pathways below
> are how a brand-new env goes from empty → useful in **under 30 minutes**.

The retrieval layer (RAG over pgvector) is already in place. This doc is
the **acquisition** side: where the chunks come from. Every pathway lands
in the **same** `sources` + `chunks` tables — the existing retrieval just
sees more data.

---

## 1 · The 30-minute onboarding promise

When a new env is created, the dashboard runs an **Intake Wizard**:

```
┌──────────────────────────────────────────────────────────────┐
│   New env "Acme Logistics" created — let's fill the brain.   │
├──────────────────────────────────────────────────────────────┤
│  1.  Drop a few docs        ← M5 (already shipped)           │
│  2.  Connect your database  ← M7 (live data, schema)         │
│  3.  Connect Slack          ← M7 (mine past threads)         │
│  4.  Invite domain experts  ← M7 (interview them)            │
│                                                              │
│  Estimated time to useful: 30 min                            │
│  Estimated facts indexed:  300-500 Q&A pairs + N rows of DB  │
└──────────────────────────────────────────────────────────────┘
```

Each step is **non-blocking**: skip any, the others still work.

---

## 2 · The four intake pathways

| # | Pathway | Latency | Authority | Volume per env (typical) |
|---|---|---|---|---|
| **A** | **File upload** (md/txt/html/pdf) | seconds | 60 | 10–100 docs · 1k chunks |
| **B** | **DB connector** (schema + sample + live query) | minutes (initial crawl), live (chat-time) | 70 | every table in their DB |
| **C** | **Channel back-mining** (Slack history → past Q&A) | hours (one-shot scan) | 65 | 100–10k threads → 200–2k Q&A pairs |
| **D** | **Member interview** (proactive + reactive) | days (proactive) · seconds (reactive) | **85** | grows organically forever |

**Authority** is the rerank weight (0–100 in `sources.authority`):

| Tier | Source kind | Why |
|---|---|---|
| 95 | Pinned-by-owner (M8 flag) | The boss said so. Beats everything. |
| **85** | Member interview Q&A | A human at the company said this. The truest source today. |
| 75 | Verified file (M8 flag — boss reviewed) | A doc but explicitly blessed. |
| **70** | DB schema description + sampled rows | Operational truth. Live data wins on "current" questions. |
| **65** | Channel back-mined Q&A | Real past answer, but staler than a current interview. |
| **60** | File upload (default) | The doc might be old or wrong. |
| 40 | Web-search result (M8 tool) | Public info, lowest trust. |

The rerank in `retrieve.ts` weights each chunk by `(0.5 + 0.5 * authority/100)`,
so a 95-tier chunk wins decisively. Authority ties get broken by **recency**:
`exp(-age_days/365)` — a 1-year-old Q&A is half-weighted vs. one from
yesterday.

---

## 3 · Pathway A — file upload (today)

Already shipped. `POST /envs/:slug/sources` multipart → chunk → embed →
insert. Authority 60. PDF support deferred to M8 (`pdf-parse`). Nothing to
re-architect.

What's missing for **fast onboarding**:

- **Bulk drag-and-drop** (today: one file at a time)
- **URL-source ingestion** — paste a Notion / Confluence / GitHub README URL,
  Argus fetches + chunks it
- **Folder watcher** — Drive / Dropbox / Notion / GitHub auto-sync

All three land in M8 once Pathway B + C + D have proved the broader thesis.

---

## 4 · Pathway B — DB connector (live, read-only)

**The win**: connect a Postgres / MySQL once, and Argus can answer
*"how many shipments were late last month?"* with a real SQL result —
no manual data export, no nightly ETL.

### 4.1 Two-phase intake

```
phase 1 — crawl (one-shot, on connect)
    information_schema → DDL of every table + columns + FK graph
    SELECT * FROM <table> LIMIT 50 → sample rows
    LLM describes each table in 2 lines ("orders: customer ID, total, status…")
    → INSERT INTO sources (kind='db_schema', authority=70)
    → one chunk per table with: DDL + sample + description

phase 2 — live query (every relevant chat call)
    agent decides: "this question needs current data"
    → tool: db.query(SELECT … LIMIT 100)
    → result returned as tool observation
    → grounded in the answer with [#1] db://orders → query: SELECT count(*)…
```

The **schema chunks** make retrieval table-aware ("you have an `orders` table
with columns …") so the LLM knows what to query. The **live query** runs
at chat time as an agent tool (M7 architecture doc, §2).

### 4.2 Connector row

```sql
-- migration 0010_db_connectors.sql
INSERT INTO connectors (env_id, kind, subtype, name, config, secret_ct, secret_iv, scope) VALUES (
  $1, 'db', 'postgres', 'acme-prod-readonly',
  '{ "host": "db.acme.com", "port": 5432, "database": "acme",
     "user": "argus_readonly",
     "schema_allowlist": ["public", "ops"],
     "sample_policy": { "rows_per_table": 50, "max_bytes_per_chunk": 4096 },
     "live_query_timeout_ms": 5000 }',
  $2, $3,
  '{ "read_only": true, "tables_allowlist": null,
     "tables_blocklist": ["secrets", "audit_log"] }'
);
```

Three layers of read-only defense:
1. **Operator-supplied role** (e.g. `GRANT SELECT ON …`). Best fence.
2. **Every query opens** `SET TRANSACTION READ ONLY` + `SET statement_timeout = 5000`.
3. **SQL parser** (`pg-query-emscripten`) rejects anything that isn't `SELECT`.

### 4.3 What gets ingested at crawl-time

For each table in the allowlist:

```
chunk_text = """
TABLE public.orders  (ops domain)
PURPOSE: customer shipping orders, one row per order.

COLUMNS:
  id            uuid       primary key
  customer_id   uuid       → public.customers(id)
  status        text       enum: 'pending','shipped','delivered','cancelled'
  total_tnd     numeric    pre-tax, in TND
  created_at    timestamptz
  shipped_at    timestamptz  null until status='shipped'

FOREIGN KEYS: customer_id → customers, route_id → routes

SAMPLE ROWS (10 of 50 sampled):
  ord_a1  c_94f  pending     32.50   2026-06-20T08:11  null
  ord_a2  c_15d  shipped     48.00   2026-06-19T14:22  2026-06-20T07:00
  …

TYPICAL QUERIES:
  - count by status:  SELECT status, count(*) FROM orders GROUP BY status
  - revenue this month:  SELECT sum(total_tnd) FROM orders WHERE created_at >= …
"""
```

That entire block is one chunk → one embedding. At chat time, the question
*"how much did we ship last week?"* embeds → cosine-matches this chunk →
the LLM sees the DDL + sample + typical-query patterns → emits a SELECT
that the `db.query` tool runs → result grounds the answer.

### 4.4 Refresh strategy

Schema changes (new column, new table) get re-crawled:

| Trigger | Action |
|---|---|
| Operator clicks "Re-crawl" | Full re-crawl, replaces chunks |
| Cron — daily | Hash the `information_schema` snapshot; if changed, re-crawl |
| Tool error "column does not exist" | Mark schema stale → re-crawl on next idle |

Sample rows are NOT refreshed automatically (privacy: a row that contained
PII in June shouldn't get re-ingested in July). Operator clicks "Refresh
samples" when they want.

### 4.5 Privacy

Sampled rows live in `chunks.text` as plaintext. For envs with regulated
data:

- `scope.tables_blocklist` excludes whole tables
- `config.sample_policy.redact_columns` — per-column regex-redaction at
  sample time (e.g. `email`, `phone`, `card_pan`) → replaced with
  `[REDACTED:email]` before insert
- An env-level flag `intake_sample_rows: false` skips sampling entirely,
  leaving only the DDL + description (lower quality but zero-PII)

---

## 5 · Pathway C — channel back-mining

**The insight**: every team's `#help`, `#general`, `#engineering` Slack already
contains *thousands* of Q&A pairs. They were just never written down.
Argus reads them once.

### 5.1 The flow

```
operator connects Slack
    → Argus lists channels its bot has access to
    → operator picks which to mine (default: #help, #faq, #ask-anyone)
        → for each channel:
            list_threads → enumerate top-level messages with replies
            for each thread:
                LLM classifies: is this a Q&A? domain?
                if Q&A:
                    Q = thread root, A = first non-bot reply that addresses it
                    INSERT INTO sources (kind='thread_mining', authority=65,
                                         uri='slack://team/channel/ts',
                                         attributed_to=<replier_user_id>)
                    embed + chunk
```

### 5.2 Cost discipline

Slack history can be 100k+ messages. Don't embed every reply.

- **Two-pass**: first pass a cheap classifier (Gemini Flash) on title only
  ("is this a question?"). Only ~10% of messages survive.
- Cap at **10k messages per channel per crawl** — bigger crawls require
  explicit operator confirmation.
- **Resumable**: cursor stored on the connector, can re-run incrementally.

### 5.3 Quality filter

Not every "?" message is worth ingesting:

| Keep | Drop |
|---|---|
| Q has a clear answer in ≤3 replies | thread has 40 replies (decision-debate, not Q&A) |
| Replier has been in #help for 6 months | replier is the asker themselves ("nvm I figured it out") |
| Answer ≥20 chars | answer is `:+1:` or just a link |
| Domain is classifiable | mostly chitchat / off-topic |

The classifier returns a `score` 0–1; keep `score > 0.6`. Operator sees
the *"X candidates, will ingest Y"* in the connect flow and can sample
20 random keeps before committing.

### 5.4 Attribution + revocability

Every back-mined chunk knows:

- `sources.attributed_to` → the user who originally answered
- `sources.uri` → deep-link to the Slack thread

If the original answerer leaves the company or revises their answer, the
operator can search-by-attribution and delete or reweight in one motion.

---

## 6 · Pathway D — member interview (the bread and butter)

Two modes:

### 6.1 Proactive interview — fill the brain on day one

After onboarding, Argus has:
- The intake wizard's domain hints ("HR", "Ops", "Sales", "Engineering")
- The freshly-crawled DB schema (Pathway B)
- A backlog of "obvious questions every team should answer"

It generates a **knowledge-gap hypothesis list** per domain:

```
HR (assigned: Amira)
  ☐ What are the office holidays for 2026?
  ☐ What's the standard parental-leave policy?
  ☐ How do we handle remote-work requests?
  ☐ Who approves new hires under 3-month probation?

Ops (assigned: Karim)
  ☐ What's our SLA for parcel delivery?
  ☐ Do we offer same-day pickup?
  ☐ What's the courier rate per parcel?
  ☐ How do we handle missed deliveries?

Sales (assigned: Sofiene)
  ☐ What are our pricing tiers?
  ☐ Can we discount for non-profits?
  ☐ What's the contract length default?
```

Each gets DMed to the assigned expert as a Slack **digest message** (NOT
one DM per question — batched, scannable, replyable in 5 minutes):

```
[Argus] Hi Amira — I'd love to learn a few HR things so I can answer
teammates' questions on your behalf. Reply with one answer per line,
or "skip" to defer.

  1. What are the office holidays for 2026?
  2. What's the standard parental-leave policy?
  3. How do we handle remote-work requests?
  4. Who approves new hires under 3-month probation?
```

Amira replies in 3 minutes. Argus parses each line → ingests four Q&A
pairs at authority 85. Tomorrow morning someone asks "is March 26 a
holiday?" — instant answer.

**~10 experts × ~5 questions each = ~50 high-authority Q&A pairs on
day one.** That's the gap between "Argus knows nothing" and "Argus is
useful enough to keep open."

### 6.2 Reactive interview — the M7 loop (see ARCHITECTURE_CHANNELS.md)

When a real chat hits a gap, Argus DMs the right expert in real-time,
ingests the reply, answers the asker. The Tunisia-Independence-Day
example. Already architected — see the sibling doc.

### 6.3 Re-confirmation loop (M8)

Knowledge ages. Argus periodically checks:

- Q&A pairs older than 6 months → DM the original answerer:
  *"Is this still accurate? [Y / N / Update]"*
- If `N` → mark `sources.confidence` = stale (rerank penalty)
- If `Update` → ingest a fresh Q&A, mark old as superseded

For deeper polish: a `sources.supersedes` UUID FK so retrieval skips
the old chunk while keeping it visible in /audit for provenance.

---

## 7 · How all four share the schema

Zero schema fork. Every pathway ends in two SQL statements:

```sql
INSERT INTO sources (env_id, kind, title, uri, authority,
                     attributed_to, created_by)
  VALUES ($env, $kind, $title, $uri, $authority, $by, $by);

INSERT INTO chunks (env_id, source_id, ord, text, tokens, embedding)
  VALUES ($env, $src, $ord, $text, $tokens, $emb::vector);
```

Differences live in `sources.kind`:

| kind | Authority | Refresh policy | Pathway |
|---|---|---|---|
| `file` | 60 | manual re-upload | A |
| `qa` | 85 | superseded on re-confirm | D |
| `db_schema` | 70 | daily hash check, manual sample refresh | B |
| `thread_mining` | 65 | one-shot crawl, resumable | C |
| `pinned` | 95 | manual | M8 owner-flag |
| `web_search` | 40 | per-call (M8 tool) | M8 |

Retrieval doesn't care — it walks the unified chunks table and the
authority weight does the work.

---

## 8 · Concrete: a brand-new env at minute 0, 15, 60

### Minute 0 — env created

- 0 sources, 0 chunks, retrieval returns `no_grounded_context` for every
  question.

### Minute 15 — wizard completed

| Pathway | Action | Sources added | Chunks added |
|---|---|---|---|
| A | 3 PDFs (handbook, pricing, FAQ) | 3 | ~120 |
| B | Postgres connect → crawl 12 tables | 12 (`db_schema`) | 12 |
| C | Slack `#help` mined → 88 Q&A | 88 | 88 |
| D | 10 experts DMed with 5 Qs each — 6 reply within the window | 30 | 30 |

**Total at minute 15: 133 sources / 250 chunks / 250 embeddings.**

### Minute 60 — first real questions land

Chat traffic finds the gaps. Each reactive interview adds 1–3 high-authority
Q&A pairs. By end of day-1, knowledge has roughly tripled.

### Day 30 — the company brain

500+ Q&A pairs, every DB table indexed, every domain has a designated
expert who's been trained to reply within minutes. The system
answers ~90% of questions instantly; the 10% it routes get answered
within hours.

That's the unfair advantage over chat-with-PDF tools: **Argus's brain
grows every day, sourced from the people who actually know.**

---

## 9 · Risks specific to fast intake

| Risk | Mitigation |
|---|---|
| **Bad ingest poisons retrieval** (one wrong answer becomes the citation) | Authority tiers + `/audit` shows every ingest with attribution. Owner can delete or re-weight in one click. |
| **PII spreads into chunks** (DB samples, Slack threads) | Per-column redaction + per-channel mining toggles + `intake_sample_rows: false` opt-out. |
| **Bot fatigue** (experts ignore proactive DMs) | Digest format (one DM, batched), opt-in domains per member, expert-score decay when ignored. |
| **Slack history misclassified as Q&A** (banter ingested as facts) | Two-pass classifier + manual sample review before commit. Stop-words list per env. |
| **DB query bills the customer for Gemini tokens on huge results** | Tool result truncated to 8KB. Per-env daily cost ceiling. SELECT … LIMIT 100 enforced parser-side. |
| **Stale knowledge** ("our pricing tier is $19" — but that changed last year) | Re-confirmation loop (M8) + recency rerank already in retrieve.ts. |
| **Conflicting answers** (two experts disagree on same Q) | Highest-authority wins; ties show both with attribution. Owner flags the truth via pin. |

---

## 10 · Ship order — make the brain real

| Sub-milestone | Pathway | Hours | Output |
|---|---|---|---|
| **M7.1** | D — reactive interview | (already designed) | Argus learns from chats it can't answer. |
| **M7.2** | D — proactive batch interview | 8h | Day-one onboarding fills 30–50 Q&A in an evening. |
| **M7.3** | B — DB schema crawl (no live query yet) | 12h | Argus knows your tables exist, can describe them, answers "what tables do we have?" |
| **M7.4** | B — live `db.query` tool | 8h | Argus answers "how many orders last week?" with a real SELECT result. |
| **M7.5** | C — Slack back-mining | 16h | Bulk-import 100s of past answers in an evening. |
| **M8** | Re-confirm + pinned + bulk URL ingest + Notion/Drive | later | Knowledge ages well. |

Total M7 effort: ~one focused week. Output: any new customer can get from
"empty env" → "Argus knows our holidays, our SLA, our database, our
past Slack answers" in a 30-minute sit-down.

That's the brain. The chat surface is just how people open the door to it.
