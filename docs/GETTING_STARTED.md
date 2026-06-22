# Getting started

End-to-end local-dev walkthrough — from `git clone` to a grounded chat reply
in your terminal. Should take ~5 minutes if Docker, Node, and pnpm are
already installed.

> **Prerequisites**: Docker (with `compose`), Node 20+, pnpm 9+, and at
> minimum a Google AI Studio key (Gemini, free tier is fine — it powers
> embeddings, which are non-optional).

---

## 1 · Clone and install

```bash
git clone https://github.com/arnisto/qrapps-argus.git
cd qrapps-argus
pnpm install
```

---

## 2 · Bring up Postgres + Redis

```bash
docker compose up -d postgres redis
```

Wait for both containers to report `(healthy)`:

```bash
docker compose ps
```

If port 5435 (Postgres) or 6381 (Redis) is busy on your machine, edit
`.env` (`POSTGRES_PORT=…` / `REDIS_PORT=…`) and restart the compose stack.

---

## 3 · Apply database migrations

The migrator scans `docker/postgres/migrations/*.sql` in lexical order and
records what's been applied in a `_migrations` table.

```bash
DATABASE_URL="postgres://argus:argus@localhost:5435/argus" \
REDIS_URL="redis://localhost:6381" \
ARGUS_INGEST_TOKEN="dev-bearer-token" \
pnpm -F @argus/api db:migrate
```

You should see lines like:

```
{"level":"info","msg":"db.migrate.starting","pending":[…]}
{"level":"info","msg":"db.migrate.applied","file":"0007_knowledge_and_auth.sql"}
{"level":"info","msg":"db.migrate.done","applied":8}
```

Verify the tables landed:

```bash
PGPASSWORD=argus psql -h localhost -p 5435 -U argus -d argus -c '\dt'
```

You should see `users`, `sessions`, `organizations`, `memberships`,
`invitations`, `envs`, `providers`, `api_keys`, `sources`, `chunks`,
`requests`, and `_migrations` — among the legacy v0.2 tables.

---

## 4 · Start the API

```bash
cd apps/api
DATABASE_URL="postgres://argus:argus@localhost:5435/argus" \
REDIS_URL="redis://localhost:6381" \
ARGUS_INGEST_TOKEN="dev-bearer-token" \
NODE_ENV=development \
pnpm dev
```

The API listens on `http://localhost:4000`. Sanity-check:

```bash
curl http://localhost:4000/healthz
# → {"status":"ok","ts":"…"}
```

> **Note**: `ARGUS_INGEST_TOKEN` is a legacy bearer that protects v0.2
> observability routes. The knowledge-layer surface uses session cookies
> + Argus API keys instead, but the env var is required to start.

---

## 5 · Start the dashboard

In a separate terminal:

```bash
cd apps/dashboard
INTERNAL_API_URL="http://localhost:4000" pnpm next dev -p 3033
```

Open **http://localhost:3033**. You'll be redirected to `/signin`.

> **`.next` permission issue?** If `pnpm next dev` errors with `EACCES` on
> `.next/`, set `NEXT_DIST_DIR=.next-local` (or anything new) — there's a
> known stale-distDir hazard if a Docker container previously built into
> `.next` with a different uid:
>
> ```bash
> NEXT_DIST_DIR=.next-local pnpm next dev -p 3033
> ```

---

## 6 · Sign up — your first user

Click **"Create an account"** on the sign-in page. Pick a name, an email,
and a password (≥8 chars). On submit:

- A row lands in `users` (bcrypt password hash).
- A personal **organization** is auto-created (slug = email local-part).
- You become **owner** of that org.
- A session cookie (`argus_session`) is set with a 30-day sliding TTL.
- You're redirected to `/dashboard`.

---

## 7 · Create an environment

`/environments → + New environment`. Give it a name (e.g. "Speedo
Express"); the slug is auto-derived. Each env is one isolated tenant — its
own connected models, knowledge core, and API keys. Slug goes into URLs
and is permanent.

---

## 8 · Connect Gemini (required) + Groq (optional)

`/models?env=<slug>`:

1. **Gemini card** — paste your `AIzaSy…` key (from
   [aistudio.google.com](https://aistudio.google.com/app/apikey)). Submit.
   The key is AES-GCM encrypted at rest; the plaintext never leaves the
   API after submission.
2. **Test button** on the row — pings `gemini-2.5-flash` with `"Reply
   with: OK"`. Should return in ~500-1500 ms.
3. *Optional:* paste a `gsk_…` Groq key in the Groq card. Same encryption.

**Why Gemini is required**: embeddings run on `gemini-embedding-001` with
`outputDimensionality=768` — that matches `chunks.embedding vector(768)`.
Groq has no embeddings endpoint. The dashboard surfaces an amber warning
if Gemini isn't connected.

**Apply across all envs**: if you have >1 env in the same org, the connect
form shows a checkbox **"Apply this key to my other N envs in {org}"**.
One click → shared key across the org. Rotating later updates them all
atomically (single `INSERT … ON CONFLICT … DO UPDATE`).

---

## 9 · Teach Argus something

`/teach?env=<slug>`:

- **File upload** — drop a `.md` / `.txt` / `.html` (5 MB max). Chunked
  inline (~2048 chars with 256 overlap), each chunk embedded via Gemini,
  inserted into `chunks` with an HNSW cosine ANN index.
- **Q&A pair** — paste a question + answer. Higher authority than file
  chunks (0.9 vs 0.6), so it outranks documents at retrieval time.

Either way, you'll see a toast like `Taught: speedo_facts.md — 1 chunk indexed (~62 tokens)`.

---

## 10 · Ask Argus a question

`/ask?env=<slug>`:

Type a question your knowledge core covers. You'll get back an answer
with a green **GROUNDED IN** label and clickable `[#N] source_title`
citation chips. Below the chat you'll see a meta footer:

```
last reply: 916ms · 215 tokens · $0.000144
```

Type a question your knowledge core *doesn't* cover. You'll see:

> I don't have that information yet.

Plus an amber **KNOWLEDGE GAP** callout with a **"Teach Argus the answer
→"** CTA. Click it, fill the answer, submit — the question auto-resends
and the next reply is grounded in the Q&A you just authored.

---

## 11 · Mint an API key + call /v1/chat/completions from your terminal

`/developer-api?env=<slug>`:

1. Type a key name (e.g. `local-test`) → **Mint key**.
2. An amber **"⚠ Shown once — copy now"** panel reveals the plaintext
   (`ak_live_…`). Copy it.
3. The cURL / Python / JavaScript tabs below show the snippet you can
   paste in your shell:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer ak_live_…YOUR KEY…" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "What is our SLA?"}]
  }'
```

Same grounded reply, same `argus_citations[]`, in a JSON response that
matches the OpenAI shape. Drop this URL into any OpenAI client by swapping
`baseURL` — the dashboard's "Try it from your terminal" panel has the
Python / JavaScript snippets pre-filled.

---

## 12 · Invite a teammate

`/members → Invite a teammate`:

- Email + role (member / admin / owner — owner can be granted only by an owner).
- Submit → a copy-once panel reveals an invitation link
  `http://localhost:3033/invite/<token>`. Share it (or open it in an
  incognito window to play both sides).
- The invitee lands on a public page that previews the org name + role,
  then handles either:
  - already signed in → one-click accept
  - existing user → sign in + accept in one form
  - brand-new user → sign up + accept in one form

Token expires in 14 days; the inviter can revoke it from the **Pending
invitations** table.

---

## Where to go next

- **[docs/STATUS.md](./STATUS.md)** — what's shipped, what's next, what's
  intentionally stubbed.
- **[docs/KNOWLEDGE_API_SPEC.md](./KNOWLEDGE_API_SPEC.md)** —
  `/v1/chat/completions` API reference + response shape.
- **[CLAUDE.md](../CLAUDE.md)** — operator notes for the Claude Code agent
  (commands, conventions, gotchas).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/healthz → 000` | API not running, or port 4000 stolen | `ss -tlnp \| grep 4000`; stop the squatting process and restart |
| `Gemini 503: high demand` | Free-tier burst on `gemini-2.5-flash` | Retry; or upgrade your AI Studio plan |
| `no_provider_configured` from /v1/chat | env has no Gemini provider | Connect Gemini on `/models?env=…` first |
| `argus_warning: no_grounded_context` | retrieved chunks are below the sim 0.6 threshold | Teach the answer via `/teach` or via the inline gap CTA on `/ask` |
| `EACCES` building `.next/` | distDir was written by a previous Docker container as a different uid | Set `NEXT_DIST_DIR=.next-local` for the host process |
| 401 on every dashboard request | Session cookie expired (30-day TTL) | Sign in again |
| `db.migrate.failed` | Postgres not up yet | `docker compose ps` — wait for `(healthy)` |
