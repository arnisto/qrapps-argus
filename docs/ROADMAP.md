# Roadmap

Order is opinionated. Items higher on the list ship first.

## v0.1 — Public launch (MVP)

See [MVP_SCOPE.md](./MVP_SCOPE.md).

- Postgres connector
- Event ingestion + schema
- Investigator runtime
- Claude + OpenAI providers
- Slack alerts
- Basic dashboard
- One-command Docker Compose

**Goal:** prove the core loop, gain OSS traction.

---

## v0.2 — More sources, more channels

- MySQL connector
- Generic REST API connector (poll + auth)
- Webhook ingestion (configured per source)
- Discord alert channel
- Email alert channel (SMTP)
- Generic webhook alert channel
- Ollama + DeepSeek providers (Gemini ships in v0.1)
- Investigator scheduling UI
- Connector test/dry-run UI

**Goal:** cover the long tail of "how do I get my data in" and "how do I get alerts out".

---

## v0.3 — Investigator authoring

- Investigator definition UI (no YAML required)
- Investigator versioning + rollback
- Test-mode runs against historical events
- Builtin investigator gallery (10+ templates)
- Per-investigator AI provider override
- Custom event types via UI

**Goal:** make non-engineers able to ship a new investigator.

---

## v0.4 — Executive intelligence

- Daily / weekly executive reports (Markdown + Slack)
- KPI shift detection (auto-generated baselines)
- Cross-investigator correlation
- "Why did X change?" investigations on demand
- Report scheduling + recipients

**Goal:** the dashboard's killer use case — exec gets one Slack message a week and trusts it.

---

## v0.5 — Investigation memory

- Long-horizon investigation context (pgvector)
- "Remember this finding" → influences future runs
- Per-organization operational memory
- Investigation chains (one finding triggers another)

**Goal:** investigations get smarter over time without retraining anything.

---

## v1.0 — Hardening + cloud

- Multi-user auth (OAuth, SSO)
- RBAC
- Audit logs
- Multi-tenant runtime
- Hosted cloud (paid tier)
- Enterprise analytics
- Prometheus metrics + OpenTelemetry traces
- Backup/restore tooling

**Goal:** production-ready for companies that don't want to self-host.

---

## Beyond v1.0

Verticalized SKUs running on the same runtime:

- **Argus Logistics** — delivery/driver/warehouse intelligence
- **Argus Fraud** — refund/payment/account-takeover investigators
- **Argus SaaS Ops** — churn, usage anomalies, support escalations
- **Argus Exec Copilot** — natural-language Q&A *grounded in findings*, not raw SQL

Plugin SDK so third parties can ship investigators, connectors, and alert channels without forking.

---

## What we will say no to

To stay focused, we will reject:

- Generic workflow automation (we're not n8n)
- Custom dashboards (we generate insights, not charts)
- Schema-free "throw any data at an LLM" mode
- Per-customer fine-tuning in v1.x
- Kubernetes-native deployment as the *primary* path (Compose stays first-class)

These constraints are a feature, not a limitation.
