# Vision

## The problem

Companies have more operational data than ever — orders, deliveries, refunds, GPS pings, support tickets, transactions. They also have dashboards, CRMs, ERPs, BI tools, and SQL warehouses.

What they still don't have is **operational reasoning**. Executives ask the same questions every week:

- "Why did refunds spike?"
- "Are we losing money on Zone B?"
- "Which drivers are suspicious?"
- "What changed after the routing update?"

These questions require connecting the dots across multiple systems, normalizing events, recognizing patterns, and writing the answer in plain language. Today this work falls on analysts, ops managers, or nobody.

## The bet

LLMs are now good enough to do **operational reasoning** at scale, continuously, on real event streams — *if* they are wrapped in the right runtime.

That runtime needs:

1. A **stable event model** so AI sees a consistent shape regardless of source.
2. **Investigators** — focused, scoped agents that look for one specific class of anomaly.
3. **Provider abstraction** so reasoning can run on Claude, OpenAI, Gemini, Ollama, or DeepSeek.
4. **Continuous execution** via job queues, not one-off prompts.
5. **An executive surface** — alerts and reports written in business language.

Argus is that runtime.

## What we are building

> An AI-native operational observability and investigation platform.

Concretely:

- **Connect** to operational databases (Postgres first, MySQL/APIs/webhooks next).
- **Ingest** rows and changes as events with a stable schema.
- **Run investigators** on those event streams continuously.
- **Generate** insights, alerts, and executive reports.
- **Deliver** to Slack/Discord/email/webhooks.

## What we are explicitly not building

- ❌ "Chat with your database" — executives should never write SQL or prompts.
- ❌ A workflow builder (n8n/Zapier).
- ❌ A dashboard builder.
- ❌ A general agent framework.
- ❌ A vector DB for everything.

We are building a **vertical product** with a strong opinion: continuous AI investigation of operational events.

## Product principles

### Executives never write

- ❌ SQL
- ❌ prompts
- ❌ schemas

The experience must be:

```
Connect your systems
→ Argus understands operations
→ Argus continuously generates intelligence
```

### Insights must be actionable

Every alert and report must answer three things:

1. **What changed?** (the anomaly)
2. **Why?** (the suspected cause, with evidence)
3. **What's the impact?** (in money, time, or risk)

If we can't answer all three, we don't ship the alert.

### Continuous, not on-demand

Argus runs all the time. Investigators wake up on schedules or event triggers. Executives consume *push*, not *pull*.

## Long-term vision

Argus becomes:

> the AI operational intelligence layer for organizations

Future verticals built on the same runtime:

- Logistics intelligence
- Fraud operations
- Operational observability for SaaS
- Executive AI copilots
- AI investigation suites
- Operational memory systems

The bet is that "operational AI" is a category, and Argus is the open-source foundation.
