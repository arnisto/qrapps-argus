# Argus

> The knowledge layer that goes in front of any LLM.

Argus is the OpenAI-compatible API that **stops your LLM from hallucinating about
your company** — by injecting grounded citations from the documents and Q&A
pairs you've taught it. Connect Gemini / Groq / OpenAI / Claude / Ollama,
upload your knowledge, and call `/v1/chat/completions` exactly like you call
OpenAI today. The response carries an `argus_citations[]` array naming the
chunks that grounded the answer.

```
┌──────────────┐     ┌──────────────────────┐     ┌────────────────┐
│  Your app    │ ──► │  Argus (knowledge    │ ──► │  Your LLM      │
│              │     │   layer + retrieval) │     │  (any provider)│
└──────────────┘     └──────────────────────┘     └────────────────┘
                              │
                              ▼
                     Grounded answer + citations
```

**It is not** "chat with your database". It is the API layer between your
application and any LLM, so every call is grounded in your data and every
answer points at the source.

---

## What's in the box today

| | What works | Where |
|---|---|---|
| **OpenAI-compatible chat** | `POST /v1/chat/completions` with `Authorization: Bearer ak_live_…` returns the OpenAI shape + `argus_citations[]` + `argus_warning` when retrieval misses | `apps/api/src/routes/chat.ts` |
| **Multi-provider routing** | Routes by model name: `gemini-*` → Gemini, `llama-*` / `mixtral-*` / `groq/*` → Groq. Embeddings always go through Gemini (`gemini-embedding-001`, 768d) to match the pgvector schema. | `apps/api/src/llm/router.ts` |
| **Knowledge ingest** | Multi-part file upload (`.md` / `.txt` / `.html`, 5 MB) or Q&A pairs. Chunked (~2048 chars, 256 overlap), embedded inline, indexed into pgvector with HNSW cosine ANN. Q&A is higher-authority than file chunks. | `apps/api/src/routes/sources.ts` · `apps/api/src/llm/chunk.ts` |
| **Multi-tenant isolation** | Every user belongs to ≥1 **org**. Orgs own **envs** (= per-customer/workspace tenants). Each env has its own connected models, knowledge core, API keys, and request log. Cross-org access is impossible. | `apps/api/src/auth/orgs.ts` |
| **Auth + sessions** | bcrypt(12 rounds), sha256 session-token hashes, HTTP-only SameSite=Lax cookies, 30-day sliding TTL. Constant-time bcrypt on missing-user signin so timing doesn't leak registration. | `apps/api/src/auth/` |
| **API keys** | `ak_live_…` minted per-env. Plaintext shown **once**; sha256-hashed at rest. Per-key rate limit + last-used tracking. | `apps/api/src/routes/api-keys.ts` |
| **Teach-then-ask loop** | Ask Argus a question it doesn't know → "Knowledge gap" inline callout → fill the answer → question auto-resends → grounded reply with citation. One screen, no nav. | `apps/dashboard/src/app/ask/Playground.tsx` |
| **Members & invitations** | Invite by email + role (owner/admin/member). 14-day shareable link. New users can sign up via the invite link in one form. Last-owner guard. | `apps/api/src/routes/members.ts` · `apps/dashboard/src/app/invite/[token]/` |
| **Shared provider keys** | One Gemini / Groq key can be applied across every env in an org with one checkbox. Rotating later updates them all atomically. | `apps/api/src/routes/providers.ts` |
| **Dashboard** | Next.js 14 App Router + Tailwind. Dark/light theme via CSS vars. Mobile-responsive slide-over sidebar. | `apps/dashboard/` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Browser / your app                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼─────────┐         ┌───────▼──────────────┐
│   Next.js 14    │         │  Your code           │
│   Dashboard     │         │  (OpenAI client      │
│   :3033 / 3036  │         │   pointed at         │
│                 │         │   /v1/chat)          │
└───────┬─────────┘         └───────┬──────────────┘
        │  /be/* rewrite            │
        │  (session cookies)        │  Bearer ak_live_…
        └────────────┬──────────────┘
                     │
          ┌──────────▼──────────────┐
          │   Fastify API :4000     │
          │ ─────────────────────── │
          │ auth, orgs, envs,       │
          │ providers, api-keys,    │
          │ sources, chat, members  │
          └─────┬──────────┬────────┘
                │          │
       ┌────────▼──┐   ┌───▼────────────────┐
       │ Postgres  │   │  External LLMs     │
       │ + pgvector│   │  Gemini · Groq · …  │
       │ :5435     │   └────────────────────┘
       └───────────┘
```

- **`apps/api/`** — Fastify, owns DB + migrations, owns auth + sessions + envs + chat
- **`apps/dashboard/`** — Next.js 14, App Router, server components fetch from `apps/api` over `/be/*` rewrites so cookies scope cleanly
- **`apps/workers/`** — BullMQ workers (legacy observability — not used by the knowledge-layer product yet)
- **`packages/`** — `shared` (config, logger, errors), `ai-providers` (legacy), `events`, `connectors`, `investigators` (legacy)
- **`docker/postgres/migrations/`** — versioned SQL files applied by `apps/api/scripts/migrate.ts`

---

## Quickstart

**One command:**

```bash
git clone https://github.com/arnisto/qrapps-argus.git
cd qrapps-argus
cp .env.example .env
docker compose up
```

This brings up Postgres (with pgvector), Redis, the API, and the
dashboard. The API container runs migrations on startup; first boot
takes ~30 s. When you see `api.listening` in the logs, open
**http://localhost:3033** and sign up — the first user gets their own
organization automatically.

To run host-side instead (for development), see
**[docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)** for the
`pnpm dev` setup.

---

## Try it from your terminal

```bash
# After connecting Gemini in the dashboard's Models page,
# uploading a markdown doc on Teach, and minting an API key:

curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer ak_live_…" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "What is our refund policy?"}]
  }'
```

Response:

```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "choices": [{ "message": { "content": "Our refund policy is … [#1]." } }],
  "usage": { "prompt_tokens": 211, "completion_tokens": 31, "total_tokens": 242 },
  "argus_citations": [
    { "index": 1, "source_title": "refund-policy.md", "source_kind": "file", "score": 0.61 }
  ]
}
```

Force routing to Groq (Llama 3.3) at ~2× the speed:

```bash
… -d '{"model": "llama-3.3-70b-versatile", "messages": [...]}'
```

When retrieval finds nothing relevant, the response carries
`"argus_warning": "no_grounded_context"` and the assistant says "I don't have
that information yet" — instead of hallucinating.

---

## Local stack ports (host-mapped)

| Service | Port | Notes |
|---|---|---|
| Postgres (pgvector) | `localhost:5435` | docker container |
| Redis | `localhost:6381` | docker container |
| Fastify API | `localhost:4000` | host process, `pnpm dev` |
| Next.js dashboard | `localhost:3033` | host process, `pnpm next dev -p 3033` |

---

## Repo layout

```
qrapps-argus/
├── apps/
│   ├── api/           # Fastify — auth, orgs, envs, chat, provider routing
│   ├── dashboard/     # Next.js 14 — the operator console
│   └── workers/       # BullMQ (legacy v0.2 — not used by knowledge-layer)
├── packages/
│   ├── shared/        # config, logger, errors, severity types
│   ├── ai-providers/  # legacy v0.2 abstraction (Claude/OpenAI/Gemini wrappers)
│   ├── connectors/    # legacy v0.2 Postgres connector
│   ├── events/        # legacy v0.2 event bus
│   └── investigators/ # legacy v0.2 investigator runtime
├── docker/
│   ├── postgres/
│   │   ├── init.sql              # v0.1/v0.2 base schema
│   │   └── migrations/           # 0002…0008, applied by apps/api/scripts/migrate.ts
│   └── api.Dockerfile
├── docs/
│   ├── GETTING_STARTED.md        # how to run it locally end-to-end
│   ├── STATUS.md                 # what's shipped, what's next
│   ├── ARCHITECTURE.md           # legacy v0.2 architecture
│   ├── ARCHITECTURE_TARGET.md    # v0.3 target architecture
│   ├── PUBLIC_EDITION_SPEC.md    # the open-source roadmap
│   ├── KNOWLEDGE_API_SPEC.md     # /v1/chat/completions API reference
│   └── … see docs/ for the full list
├── design/imports/               # claude.ai/design source files for the console
├── CLAUDE.md                     # operator notes for the Claude Code agent
├── CHANGELOG.md
└── README.md
```

---

## What's NOT in scope today

Surfaces visible in the design that are stubbed and ship later (M6+):

- **Inbox** — inbound message ingestion (WhatsApp / email / Slack)
- **Pipelines** — Kanban tickets that Argus drafts replies for
- **Connectors** — beyond file upload (Notion / Drive / Postgres ingest)
- **Agents & tools** — multi-step pipelines (Classify → Retrieve → Draft → Approve)
- **Channels** — outbound message routing
- **Audit log** — append-only, immutable view of every action

These are intentional stubs — they read as "ships in M6" in the dashboard
so a stray demo click doesn't make the live product look broken.

---

## License

AGPL-3.0 (with optional CLA for commercial relicensing). See [LICENSE](./LICENSE).

If you use Argus and want to share what you built, file an issue or open a
discussion on github.com/arnisto/qrapps-argus.
