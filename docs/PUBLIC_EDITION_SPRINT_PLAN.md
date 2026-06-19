# Argus Public Edition — Sprint Plan & Build Order

> **Reads with:** `docs/PUBLIC_EDITION_SPEC.md` (v0.3). This document is the **how**: what files to create, in what order, with what acceptance gates. Assumes the author chose path B or C from the v0.3 synthesis.

---

## Pre-sprint: validation week (per spec §13)

**Before any code is written.** 1 day of work; buys the cheapest information you'll ever get.

| Day | Task | Output |
|---|---|---|
| 1 | Write 200-word "Show HN" draft + Typeform: *"Would you self-host this? Which channel matters?"* | Draft post + form URL |
| 1 | Post in r/selfhosted (NOT r/programming). Cross-post to 1 MENA founder Slack. | Live post |
| 2–7 | Watch. Don't reply with code promises. Just measure. | Tally |

**Decision gate (day 7):**

| Signal | Action |
|---|---|
| ≥25 sign-ups | Wedge validated. Start Sprint 1. |
| 10–24 sign-ups | Marginal. Reframe the post, try one more channel, decide. |
| <10 sign-ups | **Kill the spec.** Return to the autopilot path. |

---

## Repo bootstrap (day 0 of Sprint 1)

```bash
# leave this repo alone — the autopilot lives here
cd ~/Desktop/intigo/lg
gh repo create <name>-public --public --license=agpl-3.0 --clone
cd <name>-public
```

**Locked decisions to land in commit #1:**
1. `LICENSE` — full AGPL-3.0 text.
2. `CONTRIBUTING.md` — DCO + signed-off-by requirement, Apache-style CLA reference.
3. `README.md` — placeholder with the **one-liner** from spec §1 and the legal disclaimers from spec §9.
4. `.github/workflows/ci.yml` — lint + test on PR.

**Name resolution before push** (spec §6 row 5): "Argus" is taken (Apache Argus + your autopilot). Pick a free name. Quick candidates worth a 10-minute domain/PyPI/npm/GitHub check:
- `Sahel` (شاحل — coast, fits MENA)
- `Karim` (caretaker, generous)
- `Wakil` (وكيل — agent, representative)
- `Mizan` (ميزان — balance)
- `Rasul` (رسول — messenger; literal fit for "draft reply" tool)
- `Yatim`, `Adila`, `Murshid`

Pick one, verify across **GitHub org · PyPI · npm · domain (.com or .ai) · trademark search**. Do not push v1 until locked.

---

## Repo layout (Slice 1)

```
<name>-public/
├── LICENSE                       # AGPL-3.0
├── CONTRIBUTING.md               # DCO + CLA notes
├── README.md                     # 15-min quickstart, legal disclaimers
├── SUBPROCESSORS.template.md     # for self-hosters' GDPR docs
├── docker-compose.yml            # postgres+pgvector, redis, api, worker, ollama (opt-in)
├── .env.example                  # NO secrets, only placeholders
├── alembic.ini
├── pyproject.toml                # FastAPI, litellm, pgvector, arq, pydantic, htmx-tools
│
├── engine/                       # the open-source core (single package, monorepo)
│   ├── __init__.py
│   ├── config.py                 # YAML + env loader; never hard-codes anything
│   ├── tenant.py                 # TenantContext + RLS session setter
│   ├── db.py                     # async psycopg pool + RLS-aware session
│   ├── llm.py                    # LiteLLM gateway wrapper + per-tenant rate accounting
│   ├── audit.py                  # append-only hash-chained log helpers
│   ├── crypto.py                 # per-subject keys for GDPR crypto-shred
│   │
│   ├── ingest/
│   │   ├── files.py              # watches ./inbox/, normalizes, chunks, embeds
│   │   └── normalizer.py
│   │
│   ├── knowledge/
│   │   ├── facts.py              # CRUD + upsert by (entity_id, slot_key, scope)
│   │   ├── retriever.py          # pgvector ANN + authority_rank/freshness rerank
│   │   ├── routing.py            # 3×3 policy table (intent_risk × evidence)
│   │   └── gaps.py               # cluster_key generation (Slice 2 lite — logging only)
│   │
│   ├── inbox/
│   │   ├── webhook.py            # POST /webhook/inbound (generic, HMAC-verified)
│   │   ├── classifier.py         # LLM classify intent/urgency/lang
│   │   ├── drafter.py            # LLM draft grounded reply; cite fact_ids
│   │   └── jobs.py               # arq job definitions: draft, send
│   │
│   ├── approve/
│   │   ├── ui.py                 # FastAPI routes serving HTMX templates
│   │   └── templates/            # Jinja2: inbox.html, fragment_draft.html, audit.html
│   │
│   ├── outbound/
│   │   └── webhook.py            # default outbound: POST to user's reply_webhook_url
│   │
│   └── compliance/
│       ├── erase.py              # CLI: erase --subject <ref>
│       ├── export.py             # CLI: export --subject <ref>
│       └── purge.py              # CLI: purge --before <date>
│
├── adapters/
│   ├── channels/                 # empty in Slice 1; reference adapter in Slice 1.5
│   │   └── README.md             # protocol contract + how to write one
│   └── notifications/
│       └── README.md             # protocol contract + how to write one
│
├── migrations/                   # alembic
│   └── versions/0001_initial.py
│
├── tests/
│   ├── test_facts.py
│   ├── test_routing_policy.py    # the 3×3 table is THE contract — golden tests
│   ├── test_audit_chain.py
│   ├── test_rls.py               # multi-tenant policy MUST pass even with 1 tenant
│   └── e2e/
│       └── test_quickstart.py    # the 15-minute acceptance test as a script
│
└── docs/
    ├── architecture.md
    ├── adapters.md
    ├── privacy.md                # legal disclaimers (spec §9)
    └── templates/
        ├── SUBPROCESSORS.md
        └── privacy-notice.md
```

**Key file principles:**
- **`engine/tenant.py` is load-bearing.** Every DB session goes through it. Forgetting to set `app.tenant_id` should throw, not silently leak.
- **`engine/knowledge/routing.py` is the contract** — the 3×3 policy table is the soul of the trust story. Golden tests, no exceptions.
- **`adapters/` is empty in Slice 1** — generic webhook in `engine/inbox/webhook.py` IS the reference. Adapters are how you teach others to extend.

---

## Sprint 1 — 4 weeks (the TRUE MVP)

### Week 1: Foundations (no LLM yet)

| Day | Deliverable | Acceptance |
|---|---|---|
| 1 | Repo bootstrap, license, CI green, name locked | `docker compose up` boots postgres + redis + a hello-world FastAPI route |
| 2 | Alembic migration 0001 (all spec §4 tables); `engine/db.py` async pool with RLS session | `tests/test_rls.py` — query without tenant set throws, query with tenant set returns |
| 3 | `engine/tenant.py` + `engine/config.py` + audit log + crypto-shred key store | `tests/test_audit_chain.py` — tamper a row, chain breaks |
| 4 | `engine/ingest/files.py` — drop file → normalize → chunk → embed → `knowledge_fact` row | File dropped in `./inbox/` shows up as facts within 30s |
| 5 | `engine/llm.py` LiteLLM gateway + per-tenant token accounting | Smoke test: a hardcoded prompt returns text, token counts persist |

### Week 2: The loop (LLM in)

| Day | Deliverable | Acceptance |
|---|---|---|
| 6 | `engine/inbox/webhook.py` — POST /webhook/inbound, HMAC-verified, inserts message_event, enqueues `draft` | curl → 200, row in `message_events`, job appears in redis |
| 7 | `engine/inbox/classifier.py` + `engine/knowledge/retriever.py` | Inbound classified; retrieved facts include authority_rank + freshness |
| 8 | `engine/knowledge/routing.py` — 3×3 policy table + golden tests | All 9 cells decide correctly per fixture |
| 9 | `engine/inbox/drafter.py` — composes draft citing fact_ids, respects routing decision (answer/hedge/escalate) | E2E: webhook → draft row appears with grounded citations |
| 10 | Failure handling: `draft` job catches rate-limit, retries with backoff, terminal failure writes `status='failed', error=...` | Mock 429 → draft row visible with `status='failed'` and retry log |

### Week 3: Human in the loop

| Day | Deliverable | Acceptance |
|---|---|---|
| 11 | `engine/approve/ui.py` — HTMX inbox page listing pending drafts | Open `/inbox` → see drafts, expand to see cited facts |
| 12 | Approve / Edit / Reject buttons → POST /decision/{draft_id} → inserts decision, enqueues send | Approve → `decisions` row, `send` job enqueued |
| 13 | `engine/outbound/webhook.py` — default outbound POSTs to user's `reply_webhook_url` | Approve → user's requestbin receives reply payload |
| 14 | Audit view at `/audit` — full chain rendered | Every step from inbound → send visible |
| 15 | Header banner: active LLM endpoint + "prompts leave host: YES/NO" | Visible on every page |

### Week 4: Hardening + launch

| Day | Deliverable | Acceptance |
|---|---|---|
| 16 | Compliance CLIs (`erase`, `export`, `purge`) | Erase a subject → can't be queried; audit chain intact |
| 17 | Gap-loop lite: log every drafter `escalate` decision with cluster_key; nightly `weekly_digest` job emails top-5 clusters | After 100 inbounds, digest email arrives with top clusters |
| 18 | README quickstart polished, demo GIF recorded (the launch artifact, per GTM §5) | A friend who hasn't seen the repo runs the 15-min acceptance test from README alone |
| 19 | `tests/e2e/test_quickstart.py` runs in CI | Green |
| 20 | Public launch: r/selfhosted + Show HN + 1 MENA Slack. AGPL badge, GIF on top of README. | Posted by Tuesday 9am ET |

**Slice 1 done when** the one-sentence acceptance test in spec §2 passes for a stranger, AND the launch is live.

---

## Sprint 1.5 (2 weeks, conditional on launch traction)

Trigger: ≥10 unique `docker compose up` from non-author, ≥1 issue/PR.

| Week | Scope |
|---|---|
| 1 | Slack inbound adapter + Slack approval (interactive buttons). Approves via Slack action → same `/decision` endpoint. |
| 2 | Facebook adapter: start Meta App Review. Generic outbound webhook still works for everyone else. |

---

## Sprint 2 (3–4 weeks) — THE WEDGE

| Week | Scope |
|---|---|
| 1 | Question-pattern mining detector (the *one* of the 4 detector types worth shipping per Principal Engineer): cluster escalations + drafter low-confidences by intent+entity hash. |
| 2 | Q&A answer flow: human answers a gap → new `knowledge_fact` with source_type='qa', authority_rank=80. UI in approval surface. |
| 3 | Fact freshness/decay + contradiction surfacing in approval UI. |
| 4 | Hardening + the flywheel metric instrumented: % of drafts citing `qa`-sourced facts, by tenant, by week. |

**Done when** the flywheel metric for any pilot tenant reaches ≥30% qa-cited drafts within their first month.

---

## Stack-locked install reference

`pyproject.toml` (Slice 1, no runtime fluff):

```toml
[project]
name = "<chosen-name>-engine"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi[standard]>=0.115",
  "uvicorn[standard]>=0.32",
  "psycopg[binary,pool]>=3.2",
  "pgvector>=0.3",
  "alembic>=1.13",
  "litellm>=1.50",
  "arq>=0.26",                  # redis async queue
  "redis>=5.0",
  "pydantic>=2.8",
  "pydantic-settings>=2.5",
  "watchfiles>=0.24",           # the ./inbox/ watcher
  "jinja2>=3.1",
  "python-multipart>=0.0.12",
  "httpx>=0.27",
  "cryptography>=43.0",         # crypto-shred + HMAC signature verify
  "pyyaml>=6.0",
  "typer>=0.12",                # CLIs: erase/export/purge
]

[project.optional-dependencies]
dev = [
  "ruff>=0.6", "pytest>=8.3", "pytest-asyncio>=0.24",
  "pytest-postgresql>=6.1", "respx>=0.21",
]
local-model = [
  "ollama>=0.3",
]
```

`docker-compose.yml` minimum (Slice 1):

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_PASSWORD: change-me, POSTGRES_DB: argus_engine }
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
  api:
    build: .
    command: uvicorn engine.app:app --host 0.0.0.0 --port 8000
    env_file: .env
    depends_on: [postgres, redis]
    ports: ["8000:8000"]
    volumes: [./inbox:/app/inbox, ./out:/app/out]
  worker:
    build: .
    command: arq engine.inbox.jobs.WorkerSettings
    env_file: .env
    depends_on: [postgres, redis]
    volumes: [./inbox:/app/inbox]
volumes: { pgdata: {} }
```

Ollama goes behind a `--profile local-model` flag; users without GPUs aren't forced to download a model.

---

## Acceptance gates (cumulative, hard)

| Gate | Check |
|---|---|
| **Repo public** | License visible, name verified, demo GIF on top of README |
| **Quickstart works** | Outsider runs 15-min acceptance test from README only |
| **RLS holds** | `test_rls.py` green: queries fail without tenant context |
| **No default Meta app** | Grep for `app_id=` anywhere in defaults must return zero |
| **Privacy claim honest** | Header banner shows active LLM endpoint and prompt-egress state |
| **Audit chain unbreakable** | `test_audit_chain.py` green: row tamper detected |
| **Wedge instrumented** | `weekly_digest` job exists and ran at least once |
| **Launch live** | ≥30 stars from non-author accounts within 14 days |

---

## What this plan deliberately doesn't have

- **Multi-LLM router** (LiteLLM gives you that free; the "paid extra" line in v0.2 is removed).
- **Knowledge graph queries** (table seeded, no queries; defer to Slice 3+).
- **DB connector ingestion** (Slice 3; files are enough to demo the loop).
- **Admin UI beyond inbox + audit** (`.env` + `config.yaml`).
- **Marketing copy mentioning Darija** (the feature ships free; don't promise it).
- **Default Meta app_id** (legal risk per Legal §6 — never ship one).
- **Anything Intigo-specific** (per spec §6 — this product knows nothing about logistics).

---

## What I'd do tomorrow morning if I were the author

If you choose path A (cofounder's recommendation, 6/6 panel):
- **Pre-sprint validation step** (1 day): 200-word post + Typeform. Don't write code until ≥25 sign-ups.
- **If <10 sign-ups by day 7**: archive this plan and the v0.3 spec; return to the autopilot path.

If you choose path B (build now anyway):
- Day 0: name verification (10 min).
- Day 1: repo bootstrap, license, CI.
- Day 2: start Week 1 of Sprint 1.

If you choose path C (hybrid): do the validation step Monday, and use the time to send Bassem the autopilot memo on Tuesday. Either signal lands first → execute that path.
