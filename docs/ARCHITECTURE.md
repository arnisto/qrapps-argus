# Architecture

> This document describes the **current v0.1 implementation** (TypeScript monorepo, Fastify + BullMQ + Postgres). For the venture-grade **target** architecture — three planes, semantic layer, playbook YAML, Critic agent, multi-LLM routing — see [ARCHITECTURE_TARGET.md](./ARCHITECTURE_TARGET.md).

## Style

**Event-driven + modular + AI-native.**

Argus is a monorepo of small, focused services that communicate via Postgres + Redis (BullMQ). The dashboard talks to the API; the API enqueues work; workers run investigators; investigators emit findings and alerts.

No Kubernetes. No microservices for the sake of microservices. Everything boots with `docker compose up`.

## High-level diagram

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Data       │     │  Connectors  │     │  Event Bus   │
│  Sources    │────▶│  (poll/CDC/  │────▶│  (BullMQ +   │
│  (PG/MySQL/ │     │   webhook)   │     │   Postgres)  │
│   APIs)     │     └──────────────┘     └──────┬───────┘
└─────────────┘                                  │
                                                 ▼
                                        ┌──────────────┐
                                        │ Investigator │
                                        │   Runtime    │◀─── AI Providers
                                        │  (workers)   │     (Claude, GPT,
                                        └──────┬───────┘      Gemini, Ollama,
                                               │              DeepSeek)
                              ┌────────────────┼─────────────────┐
                              ▼                ▼                 ▼
                       ┌────────────┐   ┌────────────┐   ┌──────────────┐
                       │  Findings  │   │   Alerts   │   │   Reports    │
                       │  (Postgres)│   │ (Slack/etc)│   │  (executive) │
                       └─────┬──────┘   └────────────┘   └──────────────┘
                             │
                             ▼
                       ┌────────────┐
                       │ Dashboard  │
                       │ (Next.js)  │
                       └────────────┘
```

## Components

### `apps/api` — Fastify HTTP API

- Receives ingestion (`POST /events`), webhooks, and dashboard reads.
- Manages connectors, investigators, and alert channels (CRUD).
- Enqueues investigator runs into BullMQ.
- TypeScript, Fastify, Zod for validation, Drizzle (or Prisma) for Postgres.

### `apps/workers` — BullMQ workers

- Pull jobs from queues: `connectors:poll`, `events:process`, `investigators:run`, `alerts:dispatch`.
- Each worker is a thin loop. The actual logic lives in `packages/`.
- Horizontally scalable; multiple worker containers OK.

### `apps/dashboard` — Next.js executive UI

- Server components for read-heavy views, client components for filters/interactions.
- Tailwind, TypeScript.
- No SQL surfaces. No prompt boxes. Just findings, investigations, alerts, reports.

### `packages/events`

- The event schema (Zod).
- Event bus abstraction over BullMQ.
- Idempotency keys, dedup helpers.

### `packages/connectors`

- One module per source: `postgres`, `mysql`, `api`, `webhook`.
- A `Connector` interface: `init(config)`, `poll()`, `stop()`.
- Connectors emit events into the bus; they don't talk to investigators directly.

### `packages/investigators`

- Investigator runtime: load definition → fetch context events → call AI provider → produce finding.
- Builtin investigator templates (ghost delivery, refund anomaly, etc.).
- YAML/JSON definition format (see [INVESTIGATORS.md](./INVESTIGATORS.md)).

### `packages/ai-providers`

- A `Provider` interface: `complete()`, `embed()` (later).
- Implementations: `claude`, `openai`, `gemini`, `ollama`, `deepseek`.
- Selected per-investigator or globally via config.

### `packages/shared`

- Logger, config loader, error types, utility helpers, common Zod schemas.

## Data stores

| Store    | Used for                                                |
| -------- | ------------------------------------------------------- |
| Postgres | events, findings, investigations, connectors, alerts, reports, users (later) |
| Redis    | BullMQ queues, rate-limit buckets, ephemeral state       |

We deliberately **do not** ship a vector DB in v0.1. Investigators reason over structured events, not free text. When we need embeddings (long-horizon investigation memory), we'll add pgvector — same Postgres, no new infra.

## Event-driven flow

1. **Connector** polls Postgres (or receives webhook) and emits `delivery.completed`, `refund.requested`, etc.
2. **API/Workers** validate the event with the Zod schema, dedup by `event_id`, persist to `events` table.
3. **Trigger router** matches the event to investigators that subscribe to its type.
4. **Investigator job** is enqueued. A worker picks it up, loads recent context events, calls the AI provider with a structured prompt, parses the structured response.
5. **Finding** is persisted. If severity ≥ threshold, an **alert** is enqueued.
6. **Alert dispatcher** posts to Slack/Discord/email/webhook.
7. **Dashboard** reads findings/alerts/reports from Postgres.

## Why this stack

| Choice                   | Reason                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| Node.js + TypeScript     | One language across API, workers, dashboard. Fast iteration. Strong ecosystem for connectors. |
| Fastify                  | Faster than Express, built-in schema validation, plugin model.         |
| BullMQ                   | Battle-tested Redis queue with retries, delayed jobs, repeatable jobs. |
| Postgres                 | We're an operational tool — relational is the right shape. JSONB for event payloads. |
| Next.js                  | Server components fit the "read-heavy executive dashboard" pattern.    |
| Docker Compose           | One-command setup is non-negotiable for OSS adoption.                  |
| No K8s in v0.1           | Premature complexity. Compose scales fine for self-hosters' first year. |
| AI provider abstraction  | We refuse to be locked to one model vendor. Period.                    |

## What lives in Python (later)

If/when we need it:

- Heavy time-series anomaly detection (Prophet, statsmodels).
- Custom embedding pipelines.

Until then, **everything is Node.js**. Adding a Python service is a deliberate decision, not a default.

## Scaling story

- v0.1: single Compose stack on one box, one tenant.
- v0.2: multiple worker replicas, separate Postgres for events vs. metadata.
- v1.0: multi-tenant SaaS, RBAC, audit, hosted cloud (paid tier).

We don't optimize for v1.0 problems in v0.1.
