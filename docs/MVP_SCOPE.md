# MVP Scope — v0.1

The first public release. Ruthlessly small. The goal is to launch publicly, gain OSS traction, and prove the core loop: **events in → investigation out → alert delivered**.

## In scope

### Connectors

- ✅ **PostgreSQL connector** (poll-based, configurable interval, table → event mapping).

That's it. MySQL, APIs, webhooks all wait for v0.2.

### Event system

- ✅ Stable event schema (Zod-validated).
- ✅ Ingestion endpoint `POST /events` (for manual/webhook ingestion).
- ✅ Postgres persistence with idempotency by `event_id`.
- ✅ Per-event-type indexing.

### Investigator runtime

- ✅ YAML investigator definitions.
- ✅ Scheduled and event-triggered investigators.
- ✅ Context window builder (pulls relevant recent events).
- ✅ Structured findings output (severity, summary, evidence, recommendation).
- ✅ At least 2 builtin investigators (e.g., ghost delivery, refund anomaly).

### AI providers

- ✅ Provider abstraction interface.
- ✅ **Claude** implementation.
- ✅ **OpenAI** implementation.
- ✅ **Gemini** implementation.

Ollama and DeepSeek are scaffolded but not required for v0.1.

### Alerts

- ✅ **Slack** webhook delivery.

Discord, email, generic webhooks: v0.2.

### Dashboard

- ✅ List of findings with filters (severity, investigator, date).
- ✅ Finding detail view (evidence, recommendation, source events).
- ✅ Investigator list + status.
- ✅ Connector list + last-sync status.
- ✅ Empty-state and onboarding screens.

No multi-user, no auth UI (single-user / shared secret in v0.1).

### Infra

- ✅ One-command boot: `docker compose up`.
- ✅ Postgres + Redis + API + workers + dashboard, all containerized.
- ✅ `.env.example` with every required key documented.
- ✅ Migrations on boot.
- ✅ Healthchecks for each service.

## Out of scope (explicitly)

- ❌ Auth (beyond a shared secret env var)
- ❌ RBAC / multi-user / multi-tenant
- ❌ Audit logs
- ❌ Investigation memory / long-term context
- ❌ MySQL connector
- ❌ Generic API connector
- ❌ Webhook ingestion config UI
- ❌ Discord / email / generic webhook alerts
- ❌ Executive PDF reports
- ❌ Vector DB / embeddings
- ❌ Investigator marketplace
- ❌ Hosted cloud
- ❌ Kubernetes manifests
- ❌ Helm charts
- ❌ Plugin SDK (later, once the runtime stabilizes)

## Definition of done for v0.1

A new user can:

1. `git clone` the repo
2. `cp .env.example .env`, set their AI provider key + Slack webhook
3. `docker compose up`
4. Open the dashboard, point a Postgres connector at a sample DB
5. Within 5 minutes see at least one investigation result
6. Receive a Slack alert when severity ≥ medium

If steps 1–6 don't work end-to-end on a clean machine, we don't tag v0.1.

## Success metric for v0.1

We're not measuring revenue. We're measuring:

- ⭐ GitHub stars (target: 500 in first 30 days)
- 🛠️ Self-hosted installs (telemetry-opt-in count)
- 📥 Issues + PRs from non-team contributors
- 🗣️ Mentions in dev/ops communities

If the core loop is compelling, the rest follows.
