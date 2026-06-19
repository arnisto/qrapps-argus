# Argus Knowledge Engine — Working Spec

> The actual product, not the design. Locks the contracts and modules that turn the
> imported Argus Console into a working knowledge-augmented LLM proxy. Built to
> scale: every choice notes where the next scaling decision belongs.
>
> **Built from** the user's stated vision (connect LLMs → train via RAG → expose a
> developer API that calls the same LLM but enriched) and prior advisor panels
> (cf. `docs/PUBLIC_EDITION_SPEC.md` §3.1 stack lock; `docs/AGENT_LOOPS.md` for the
> truth-oracle discipline).

---

## 1. One-line product

> **Argus is a knowledge layer in front of any LLM.** You connect your provider
> (Gemini, Groq, OpenAI, …), teach Argus with files and answers, and get back an
> OpenAI-compatible `/v1/chat` endpoint that calls the same model — but with your
> knowledge retrieved and injected, with citations.

## 2. The wedge demo (5-minute test that proves it works)

```
1.  curl /v1/providers add Gemini    (store API key + default model)
2.  curl /v1/ingest    upload one PDF  (chunk → embed → pgvector)
3.  curl /v1/keys      create an Argus API key
4.  curl /v1/chat  -H 'Authorization: Bearer <argus-key>'        \
        -d '{"model":"gemini-2.5-flash",
             "messages":[{"role":"user","content":"<a question about the PDF>"}]}'
5.  ➜ response.choices[0].message.content cites the PDF; argus_citations field
    contains the chunk_ids that grounded the answer.
```

If those five lines work, the product works. Everything else is iteration.

---

## 3. Architecture (locked)

```
                   ┌────────────────────────────────────────┐
                   │      Developer App (any client)        │
                   │ "set baseUrl = http://argus/v1, done"  │
                   └────────────────────────────────────────┘
                                       │  POST /v1/chat
                                       │  Authorization: Bearer ak_…
                                       ▼
                    ┌─────────────────────────────────┐
                    │   auth + rate-limit (api_key)   │
                    └──────────────┬──────────────────┘
                                   ▼
                    ┌──────────────────────────────┐         ┌─────────────────┐
                    │ retrieve(query, tenant, k=8) │ ◄────── │  ke_chunk       │
                    │   pgvector cosine ANN        │         │  + embedding    │
                    │   + recency × authority rerank│        │  (pgvector HNSW)│
                    └──────────────┬───────────────┘         └─────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │ build augmented prompt:      │
                    │   <retrieved context>\n      │
                    │   <user messages>            │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐         ┌─────────────────┐
                    │  providers.call(model, …)    │ ──────► │  Gemini / Groq  │
                    │  (LiteLLM-style adapter)     │         │  / OpenAI / …   │
                    └──────────────┬───────────────┘         └─────────────────┘
                                   ▼
                ┌──────────────────────────────────────┐
                │ ke_request log (tokens, cost, ms,   │
                │ chunks_used, status, api_key_id)    │
                └──────────────────────────────────────┘
                                   ▼
                          OpenAI-shaped JSON  +  argus_citations[]
```

---

## 4. Data model (`autopilot.ke_*` — same schema as the engine)

```sql
-- 4.1 Connected LLM providers (Gemini, Groq, OpenAI, …)
CREATE TABLE ke_provider (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,                -- 'gemini', 'groq', 'openai'
  api_key_enc  TEXT NOT NULL,                -- encrypted via APP secret
  default_model TEXT NOT NULL,
  base_url     TEXT,                          -- override for groq/etc
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- 4.2 Argus-side API keys that developers use to call /v1/chat
CREATE TABLE ke_apikey (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,                -- 'My App Prod', 'Cursor', …
  key_prefix   TEXT NOT NULL,                -- visible in UI: 'ak_live_8f3a…'
  key_hash     TEXT NOT NULL UNIQUE,         -- sha256, never stored cleartext
  scopes       TEXT[] NOT NULL DEFAULT '{chat:read,ingest:write}',
  rate_per_min INT NOT NULL DEFAULT 60,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- 4.3 Ingested sources (uploaded files OR human-answered Q&A)
CREATE TABLE ke_source (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  kind         TEXT NOT NULL,                -- 'file' | 'qa' | 'url'
  title        TEXT NOT NULL,
  uri          TEXT,                          -- filename, URL, etc.
  bytes        INT,
  mime         TEXT,
  authority    REAL NOT NULL DEFAULT 0.7,    -- file=0.6, qa=0.9, url=0.5
  added_by     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.4 Embedded chunks (the searchable knowledge unit)
CREATE TABLE ke_chunk (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  source_id    BIGINT NOT NULL REFERENCES ke_source(id) ON DELETE CASCADE,
  chunk_no     INT NOT NULL,
  content      TEXT NOT NULL,
  tokens       INT,
  embedding    vector(768),                  -- Gemini text-embedding-004 dim
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ke_chunk_emb_idx ON ke_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ke_chunk_tenant_idx ON ke_chunk (tenant_id, source_id);

-- 4.5 Every /v1/chat request (the cost + audit trail)
CREATE TABLE ke_request (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  apikey_id    BIGINT REFERENCES ke_apikey(id) ON DELETE SET NULL,
  model        TEXT NOT NULL,
  provider     TEXT NOT NULL,
  prompt_tokens INT,
  completion_tokens INT,
  total_tokens INT,
  latency_ms   INT,
  cost_usd     NUMERIC(12,6),
  chunks_used  INT,
  citations    BIGINT[],
  status       TEXT NOT NULL,                -- 'ok' | 'rate_limited' | 'provider_error'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ke_request_apikey_idx ON ke_request (apikey_id, created_at DESC);
```

**Scale note per table.** `ke_chunk` is the hot path — HNSW index handles ~10M
vectors with sub-100ms p99. When the tenant base grows past ~50 tenants we
partition `ke_chunk` by `tenant_id` (Postgres native). When a single tenant
exceeds 5M chunks we move that tenant to a dedicated Qdrant index. Until then,
HNSW in PG.

---

## 5. Engine modules (Python, no new heavy deps)

```
mvp/argus_roi/autopilot/engine/
├── __init__.py
├── providers.py     # LiteLLM-style router. Today: Gemini, Groq, OpenAI.
│                    # Each provider implements: complete(messages, model, **opts) -> dict
│                    #                          embed(texts, model) -> list[vector]
│                    # Selection: model name → provider. Per-tenant API keys via ke_provider.
├── ingest.py        # ingest_file(path) and ingest_qa(question, answer):
│                    # parse → chunk (~512 tokens, 64 overlap) → embed in batches of 32 → INSERT
│                    # supports text, markdown, PDF (via pypdf-stdlib fallback)
├── retrieve.py      # retrieve(query, tenant_id, k=8) →
│                    # 1. embed query
│                    # 2. SELECT … ORDER BY embedding <=> $q  LIMIT k*3   (over-fetch)
│                    # 3. rerank by score × source.authority × recency_decay
│                    # 4. return top k chunks with source metadata
├── chat.py          # chat(messages, model, tenant_id) →
│                    # 1. last user msg → retrieve()
│                    # 2. build system prompt: "Use ONLY these facts ... [chunks]"
│                    # 3. providers.complete()
│                    # 4. return OpenAI-shaped dict + argus_citations
├── keys.py          # generate(name, scopes) → returns plaintext key ONCE,
│                    # store sha256 hash. verify(bearer) → (apikey_id|None).
└── secret.py        # AES-GCM encrypt/decrypt provider api_keys with APP_SECRET env.
```

**Why no LiteLLM library yet** — adds a heavy dep for what is ~80 LOC. The
adapter pattern in `providers.py` is the contract; swap in the LiteLLM package
the day we onboard the 4th provider, no callers change.

---

## 6. HTTP API (locked contracts)

All under `/v1/*`. Bearer-token auth on every endpoint except `/v1/providers`
(admin) and `/v1/keys` (admin). Designed to be drop-in for OpenAI clients.

### 6.1 `POST /v1/chat/completions` — the wedge

Request (OpenAI-compatible):
```json
{
  "model": "gemini-2.5-flash",
  "messages": [{"role": "user", "content": "When does my refund window end?"}],
  "temperature": 0.3,
  "argus": {"k": 8}                  // optional Argus-specific extension
}
```

Response (OpenAI-shaped + Argus extension):
```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "created": 1737550000,
  "model": "gemini-2.5-flash",
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "Per your refund policy …"}, "finish_reason": "stop"}],
  "usage": {"prompt_tokens": 412, "completion_tokens": 78, "total_tokens": 490},
  "argus_citations": [
    {"chunk_id": 1284, "source_id": 17, "source_title": "Refund policy v3.pdf", "score": 0.86}
  ]
}
```

### 6.2 `POST /v1/ingest` — teach Argus
- Multipart: `file` (PDF/MD/TXT, ≤25 MB), or
- JSON: `{"kind": "qa", "question": "...", "answer": "..."}`
- Returns: `{"source_id": 17, "chunks": 23, "tokens": 5840}`

### 6.3 `POST /v1/keys` — issue Argus API key
- Returns: `{"key": "ak_live_…", "id": 5}` — **key is shown ONCE**.
- `GET /v1/keys` → list (prefix only, no full key).
- `DELETE /v1/keys/{id}` → revoke.

### 6.4 `POST /v1/providers` — connect an LLM
- `{"name":"gemini","api_key":"AIza…","default_model":"gemini-2.5-flash"}`
- Stored encrypted (`engine/secret.py`).

### 6.5 `GET /v1/sources`, `DELETE /v1/sources/{id}` — manage knowledge.

### 6.6 `GET /v1/requests` — request log (auditable cost view).

---

## 7. UI (working pages — separate from the design preview)

| Route | Surface | Backing endpoints |
|---|---|---|
| `/` | The design preview (Claude Design import) — unchanged | static |
| `/teach` | File upload + Q&A entry. Sources table. | `/v1/ingest`, `/v1/sources` |
| `/models` | Connect providers (Gemini / Groq / OpenAI), test connection. | `/v1/providers` |
| `/api` | API keys (create/revoke), code snippets (curl + Python + JS), request log. | `/v1/keys`, `/v1/requests` |
| `/playground` | Quick chat tester — runs `/v1/chat` against the connected model + your knowledge. | `/v1/chat/completions` |
| `/old/*` | The original autopilot real-data pages (Reports, etc.) | autopilot tables |

These are **plain server-rendered HTML** (matching `app.py`'s existing pattern).
The design at `/` stays beautiful and visual; these are the working operator
surfaces.

---

## 8. What "built to scale" means here, concretely

| Concern | Today (MVP) | First scaling move | When to make it |
|---|---|---|---|
| HTTP layer | Python stdlib `http.server` (threaded) | swap to FastAPI + uvicorn | when sustained traffic >50 req/s |
| Embeddings | Gemini `text-embedding-004` (768d), in-process | async batch + Redis queue | when ingest >10k chunks/min |
| Vector store | pgvector HNSW in argus PG | per-tenant partition, then Qdrant for hot tenants | >50 tenants OR >5M chunks/tenant |
| Provider calls | per-request synchronous | shared `httpx` pool, retry-on-429 with backoff | day 1 in `providers.py` |
| Auth | sha256-hashed API keys | bcrypt + JWT for short-lived session keys | when self-serve signup ships |
| Rate limit | column-only (`rate_per_min`) — not enforced | Redis token bucket per `apikey_id` | day 2 of public access |
| Observability | `ke_request` table | OpenTelemetry export to a self-hosted Tempo | when we hit 5+ models |
| Multi-tenant | `tenant_id` column on every row | Postgres RLS policies + per-tenant secrets in KMS | onboarding tenant #2 |
| Secrets | `engine/secret.py` AES-GCM with `APP_SECRET` env | cloud KMS (AWS / GCP) reference per tenant | Phase B SaaS |

**No premature optimization.** The MVP is single-tenant on one box. Every row in
the table is the bare-minimum hook so the next-step swap is hours of work, not a
rewrite.

---

## 9. Hard guardrails (non-negotiable)

1. **API keys never logged.** Plaintext shown once at creation, then hash-only.
2. **Provider API keys encrypted at rest** (AES-GCM via `engine/secret.py`,
   `APP_SECRET` from env, never the DB).
3. **No outbound traffic except to configured providers.** Egress goes through
   `providers.py`; nothing else makes HTTP calls.
4. **Grounded-only refusal**: when retrieval returns zero relevant chunks AND
   the response is about a "what does the company say" question, the response
   includes a `argus_warning: "no_grounded_context"` field so the caller knows.
5. **`/v1/chat` is OpenAI-shape compatible.** Adding fields to responses is
   allowed; renaming or restructuring existing fields is not. This is the
   "drop-in by changing baseUrl" promise.
6. **Per-tenant isolation enforced in `engine/`, not just the SQL.** No SELECT
   without a `tenant_id` filter, ever.

---

## 10. Success criteria for this build (the proof)

**The 5-line wedge demo from §2 runs end-to-end with a real Gemini key, a real
PDF, and a real curl — and the answer cites the PDF.**

When that passes, we have a working knowledge-augmented LLM proxy. Everything
else (the design preview, multi-tenancy, scaling, Slack/email delivery, the
agents UI) is iteration on top of a working spine.

Acceptance test script lives at `mvp/argus_roi/autopilot/tests/e2e_chat.sh` —
written when the build is done.
