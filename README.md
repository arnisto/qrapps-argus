# Argus

> AI-native operational observability and investigation platform.

Argus is an open-source AI operational intelligence platform that connects to your company databases and continuously analyzes operational events to:

- generate executive insights
- detect anomalies
- investigate suspicious patterns
- recommend actions automatically

It is **not** "chat with your database". It is the AI layer that watches your operations and surfaces what matters — without anyone writing SQL or prompts.

---

## What Argus Is

Companies already have databases, dashboards, CRMs, ERPs, and operational systems. What executives still lack is **real-time operational reasoning**: anomaly detection, proactive insights, and investigations that connect the dots across systems.

Argus turns operational data into:

- 📊 **Business insights** — what changed, why, and what it costs.
- 🔍 **AI investigations** — autonomous agents that drill into suspicious patterns.
- 📑 **Executive reports** — readable, dated summaries of what's happening.
- 🚨 **Anomaly alerts** — Slack/Discord/email/webhook delivery.
- ✅ **Operational recommendations** — concrete actions, not dashboards.

```
Data Sources
    ↓
Event Ingestion
    ↓
AI Investigators
    ↓
Operational Intelligence
    ↓
Alerts / Reports / Recommendations
```

---

## Example Output

```
Refund anomalies increased 18%.

Main causes:
- 3 drivers linked to 42% of suspicious refunds
- Zone B delivery failures increased after routing update
- Late deliveries correlate with one warehouse cluster

Estimated monthly impact: €12,400
```

---

## Quickstart

```bash
git clone https://github.com/qrapps/argus.git
cd argus
cp .env.example .env
docker compose up
```

That's it. Open `http://localhost:3000` for the dashboard, `http://localhost:4000` for the API.

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for the local dev workflow.

---

## Repo Structure

```
qrapps-argus/
├── apps/
│   ├── dashboard/        # Next.js + Tailwind + TS executive UI
│   ├── api/              # Fastify HTTP API (events, investigations, alerts)
│   └── workers/          # BullMQ workers running investigators
│
├── packages/
│   ├── investigators/    # Investigator runtime + builtin templates
│   ├── connectors/       # Postgres / MySQL / API / Webhook connectors
│   ├── ai-providers/     # Provider abstraction: Claude, OpenAI, Gemini, Ollama, DeepSeek
│   ├── events/           # Event schema, validators, bus
│   └── shared/           # Types, logger, config, utils
│
├── docker/               # Per-service Dockerfiles + init scripts
├── infra/                # Compose overrides, seed data, dev fixtures
├── docs/                 # Architecture, vision, roadmap, contributing
└── docker-compose.yml
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design.

---

## MVP Scope (v0.1)

The first public release deliberately ships only:

- ✅ PostgreSQL connector
- ✅ Event ingestion pipeline
- ✅ AI investigator runtime
- ✅ Slack alerts
- ✅ Basic executive dashboard
- ✅ Docker Compose one-command setup
- ✅ Claude + OpenAI + Gemini provider support

That's it. Everything else is roadmap. See [docs/ROADMAP.md](./docs/ROADMAP.md).

---

## Differentiation

Argus is **not**:

- ❌ n8n / Zapier (it doesn't run user-defined workflows)
- ❌ AI SQL chatbot (executives never see SQL)
- ❌ A dashboard builder (we generate insights, not charts)
- ❌ A general LLM agent platform

Argus **is**:

- ✅ AI operational intelligence
- ✅ AI investigators reasoning over events
- ✅ Operational anomaly detection
- ✅ Executive insight generation
- ✅ Continuous monitoring

---

## Open Source Strategy

**Open core, source-available cloud.** The runtime, investigators, connectors, dashboard, and alerts are all OSS. Hosted cloud, RBAC, multi-tenancy, audit logs, and advanced reasoning land in a paid tier later.

See [docs/OPEN_SOURCE_STRATEGY.md](./docs/OPEN_SOURCE_STRATEGY.md).

---

## Documentation

- [VISION.md](./docs/VISION.md) — what we're building and why
- [STRATEGY.md](./docs/STRATEGY.md) — wedge, moat, GTM, 90-day MVP, risks
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) — current v0.1 system design
- [ARCHITECTURE_TARGET.md](./docs/ARCHITECTURE_TARGET.md) — target three-plane architecture (north star)
- [AGENT_LOOPS.md](./docs/AGENT_LOOPS.md) — four-loop agent runtime, auto-correction, budgeting
- [KNOWLEDGE_GRAPH.md](./docs/KNOWLEDGE_GRAPH.md) — locked decisions + scaffolding for the Living Knowledge Graph
- [MVP_SCOPE.md](./docs/MVP_SCOPE.md) — what ships in v0.1
- [ROADMAP.md](./docs/ROADMAP.md) — what's next
- [INVESTIGATORS.md](./docs/INVESTIGATORS.md) — how to write an investigator
- [CONNECTORS.md](./docs/CONNECTORS.md) — connecting data sources
- [AI_PROVIDERS.md](./docs/AI_PROVIDERS.md) — provider abstraction
- [EVENTS.md](./docs/EVENTS.md) — event schema and ingestion
- [DEVELOPMENT.md](./docs/DEVELOPMENT.md) — local dev workflow
- [CONTRIBUTING.md](./docs/CONTRIBUTING.md) — how to contribute
- [OPEN_SOURCE_STRATEGY.md](./docs/OPEN_SOURCE_STRATEGY.md) — open core model

---

## License

Apache-2.0. See [LICENSE](./LICENSE).
