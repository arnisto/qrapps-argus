# Strategy

> Captured 2026-05-12. This document records the venture-level strategy behind Argus: the wedge, the moat, the architecture choices that flow from it, the 90-day MVP, pricing, GTM, risks, and the long-term defensibility plan.
>
> Companion to [VISION.md](./VISION.md) (product) and [ROADMAP.md](./ROADMAP.md) (execution). When this doc and those disagree, the more recent one wins — note the change here.

---

## 1. What we're actually selling

"AI talks to your DB" is a crowded space (Hex, Mode, ThoughtSpot Sage, Julius AI, Definite, Athenic, Numbers Station, MotherDuck's Spongey). They are generic SQL chatbots answering ad-hoc questions. **None of them produce a C-suite memo with sized opportunities and prioritized actions.** That is our gap.

We are **not** selling:

- ❌ "Chat with your DB"
- ❌ BI dashboards
- ❌ Yet-another-text-to-SQL

We are selling:

> **Every Monday at 7 a.m., a board-grade memo lands in the CEO's inbox: this is what changed, this is what's bleeding, here are 5 sized opportunities worth N TND/€/$ this quarter, ranked by effort. With proof.**

That phrasing is the elevator pitch, the landing page hero, the cold-email subject line. It is the bar every product decision must hold against.

The three features competitors will demo against us:

1. **Scheduled exec reports** — not on-demand Q&A.
2. **Opportunity discovery** — not question-answering.
3. **Sizing in money** — not counts or percentages.

---

## 2. The real IP — what's defensible

Most technical layers are commodities. Be honest about which:

| Layer | Commodity? | Our moat |
|---|---|---|
| LLM (Claude/GPT/Gemini/local) | Yes | None — multi-LLM is table stakes |
| Text-to-SQL (LangChain, Vanna) | Yes | None — but quality matters |
| Schema introspection | Yes | None |
| **Opportunity Playbook** | **No** | **YOUR moat** |
| **Sizing engine** | **No** | **YOUR moat** |
| Executive voice / memo composer | Half | Domain-tuned prompts + few-shot |
| Connectors (DBs, news, weather, FX) | Mostly | Curation only |

The **Opportunity Playbook** is the product. It is a library of pattern templates — revenue concentration, sleeping giants, pricing leakage, surcharge utilization, return-rate hotspots, aging receivables, vendor concentration, driver/employee productivity tails, churn proxies, cash trapped in COD floats.

Each template looks like:

```yaml
- id: pricing_leakage
  domain: marketplace | logistics | saas | retail
  hypothesis: "Some customers pay below the median fee for their volume tier"
  inputs:
    - revenue_per_unit   # mapped via semantic layer
    - customer_volume
  detection_sql_template: "..."
  sizing: "(median_fee - actual_fee) * volume_30d"
  narrative: "<LLM fills with names, numbers, action>"
  recommended_action: "Renegotiate tier; if active < N, blacklist"
```

**Target: 30 templates.** They cover ~80% of what every B2B / marketplace / logistics company needs. That catalog is the asset we license.

This aligns directly with the existing [INVESTIGATORS.md](./INVESTIGATORS.md) concept — investigators are the runtime form of playbook templates.

---

## 3. Architecture — BYO-DB + BYO-LLM + BYO-data

Five-layer stack. Build cleanly because pieces will be swapped every quarter. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system view; this section is the *strategic* layering.

```
┌─────────────────────────────────────────────────────────────┐
│  6. Delivery   →  Email, Slack, PDF, Notion, dashboard       │
├─────────────────────────────────────────────────────────────┤
│  5. Composer   →  Memo writer (Claude/GPT), tone presets,    │
│                   sizes findings, prioritizes by ROI         │
├─────────────────────────────────────────────────────────────┤
│  4. Playbook   →  30+ opportunity templates, scheduled runs, │
│   ─── IP ───       custom playbooks per industry             │
├─────────────────────────────────────────────────────────────┤
│  3. Semantic   →  Canonical concepts (Revenue, Customer,     │
│      Layer         Expense, COD, Refund) → client schema     │
│                    Built per-tenant once, then reused        │
├─────────────────────────────────────────────────────────────┤
│  2. Connectors →  Postgres, MySQL, Snowflake, BigQuery,      │
│                   SQLite, Mongo, REST. Read-only role.       │
│                   External: news, stocks, FX, weather, X     │
├─────────────────────────────────────────────────────────────┤
│  1. LLM Router →  Claude / GPT / Gemini / local (Llama,      │
│                   Qwen). Cost-routed per task: planning →    │
│                   Opus, SQL gen → Sonnet, summaries → Haiku  │
└─────────────────────────────────────────────────────────────┘
```

### Non-obvious choices to lock in now (expensive to undo)

- **Read-only, scoped DB role per tenant**, with explicit allowlisted tables. Finance data is the most regulated category there is. One mistake here is fatal.
- **Every number in the memo links to the SQL that produced it.** Click → see the query → see the rows. This is how we survive the inevitable "this number is wrong" call from a CFO. Trust = retention.
- **Cache the plan, not the result.** Opportunity templates compile to SQL plans; data refresh runs nightly. We do not re-prompt the LLM every Monday for the same insight.
- **Semantic layer is YAML, not magic.** Onboarding is a guided session: "Where is your revenue? Your customer table? Your refund flag?" Once mapped, every playbook works. This is what makes us sellable across companies with different DBs — *not* "AI figures it out" (which fails 30% of the time and costs the customer).
- **External plugins via tool-calling**: news (Perplexity, Tavily, NewsAPI), stocks (Alpha Vantage, Polygon), weather (Open-Meteo), FX (exchangerate-api). Surfaced as "context boosters" — e.g. *"your fuel costs rose 18% — note that Brent is +12% MoM, so ~6% is operational."*

---

## 4. Concrete tech stack

Build for shipping fast, not for HN points.

- **Backend**: Python (FastAPI). The SQL/data ecosystem in Python is unmatched.
- **LLM orchestration**: **Do not use LangChain.** Use SDKs directly (`anthropic`, `openai`, `google-genai`) + a thin router. LangChain abstractions hurt when debugging a prompt at 11pm.
- **Prompt caching**: Critical for cost. The schema + semantic layer + playbook YAML is identical every run — cache the system prompt. Anthropic prompt caching cuts ~80% of cost for repeat runs.
- **DB drivers**: SQLAlchemy + raw `psycopg`/`mysqlclient`. Every generated query runs inside a `READ ONLY` transaction with a 30-second statement timeout.
- **Background jobs**: Temporal or Inngest. Not Celery — too painful for retryable LLM chains.
- **Frontend**: Next.js + shadcn. Memos render as markdown with collapsible SQL receipts.
- **Multi-tenancy**: Postgres row-level security on the control plane; per-tenant credentials encrypted with KMS-style envelope. Never co-mingle.
- **Observability**: Langfuse or Helicone for LLM traces. Every prompt that goes out must be inspectable.

> Note: the current Argus repo is a TypeScript/pnpm monorepo. This section documents the *strategic preference* for the Python data-engine path; the JS/TS app surface (Next.js frontend, delivery layer) remains as-is. If we converge on a single stack, update this section.

---

## 5. The 90-day MVP

Ship **one vertical, one DB, one LLM.** Marketplace / logistics on Postgres with Claude. There are thousands of Tunisian/MENA/African logistics startups with similar Django+Postgres stacks. Sell to them first.

| Days | Milestone |
|---|---|
| 0–14 | Spike: hard-code the 8 patterns produced for Intigo, run them end-to-end on 2 other companies' Postgres (friendly design partners). Output a real PDF. |
| 15–30 | Build the semantic-layer onboarding wizard. Goal: a non-technical analyst can onboard a new DB in <1 hour. |
| 31–60 | Productize the playbook YAML. Build 20 templates. Add Slack + email delivery. Self-serve trial. |
| 61–90 | Add LLM routing (Claude + GPT + local fallback), prompt caching, query receipts UI, basic billing. Onboard 3 paying design partners at €500/mo. |

After 90 days, what's working determines the next move (vertical expansion vs. deeper playbook vs. enterprise sales).

This complements [MVP_SCOPE.md](./MVP_SCOPE.md) — read both together.

---

## 6. Pricing & GTM

### Pricing (the anchor matters more than the number)

| Tier | Price | Includes |
|---|---|---|
| **Starter** | €499/mo | 1 DB, 1 weekly memo, email + Slack |
| **Growth** | €1,499/mo | 3 DBs, daily insights, custom playbooks, history & alerts |
| **Enterprise** | €4,000–10,000/mo | SSO, on-prem LLM option, audit logs, custom semantic mapping, dedicated SLAs |

**Enterprise is where the money is** — sell to companies doing €5–50M revenue who don't have a data team. The memo is worth a junior analyst (€2.5k/mo) and replaces them.

### GTM (in order)

1. **Sell to one CEO who already knows us.** Bassem at Intigo. Get a testimonial: *"AI-generated CFO memo found €1.2M/year of margin we were missing."* That single quote sells the next 20.
2. **MENA logistics-tech LinkedIn outbound** — there is an obvious cluster: First Delivery, Aramex MENA, Anaxago, Wassalni, ShipShop, etc. Run the demo on synthetic data of their public profile.
3. **French SMB & African e-commerce** — same Postgres+Django pattern, similar pain.
4. **Only later**: Snowflake/BigQuery and US mid-market. Competition is real there.

---

## 7. External-data plugins (do this last)

This is the "wow demo" feature, but it is product theatre until the core works.

Design pattern when we add it:

- For each opportunity finding, the composer asks: *"Would external context change the interpretation?"*
- If yes (e.g. *"fuel cost +18%"*), call the right tool (news search on "Brent crude price March 2026", weather API on Tunis flood dates, FX on TND/USD).
- Inject 1–2 sentences of context, **with citation**. Never let the model speculate without a source.

The plugin contract is small:

```python
class ContextPlugin(Protocol):
    name: str
    triggers: list[str]  # which finding-types it applies to
    def fetch(self, finding: Finding) -> Citation | None
```

Build 4: news, weather, FX, public stocks. Anything else is YAGNI.

---

## 8. The real risks and mitigations

| Risk | Mitigation |
|---|---|
| OpenAI/Anthropic build it themselves | They won't ship the playbook IP or industry semantic layer. Stay vertical. |
| Hallucinated numbers kill trust | Every number must link to its SQL. No model-only arithmetic. The DB is the calculator. |
| Schema variance is endless | Semantic layer + paid onboarding for the first 50 customers. Encode learnings into playbook variants. |
| Data-security objection blocks sales | Self-hosted option from day 1 (Docker image). On-prem LLM via vLLM/Ollama for the paranoid. |
| Long sales cycles to CFOs | Sell to the CEO/founder, not the CFO. Founders make instant decisions. |
| You become a consultant, not a SaaS | Hard rule: every custom playbook built for a customer goes into the shared catalog (with consent). After 20 customers, no more bespoke work. |

---

## 9. Defensibility over 24 months

- **Year 1 moat**: playbook catalog + executive voice.
- **Year 2 moat**: benchmarking layer. With 100 customers in logistics, we can tell company N+1: *"Your return rate of 22% is worse than 68% of your peers; your fuel-per-delivery is in the top quartile."* Nobody else has that dataset. This is the long game and is worth a 10× valuation premium.

---

## What to start tomorrow

1. **Tonight** — Show Bassem the Intigo memo. Get a yes/no on him being design partner #1. The whole plan depends on this.
2. **This week** — Strip the 8 patterns run on Intigo into a `playbook/` directory of YAML files. Each one a separate file.
3. **Next week** — Write the smallest possible runner: Python script, takes a DB URL + playbook dir + Claude key, outputs a markdown memo. No UI yet.
4. **Week 3** — Run it on 2 other Postgres DBs of friendly companies. See what breaks. The semantic layer is where you'll bleed; budget time accordingly.
5. **Week 4** — Decide: full-time or moonlight. Don't half-build this — the market window for "vertical AI agent" is ~24 months wide.

---

## Open questions

- Does the Python data-engine path replace, or live alongside, the current TS monorepo? (See §4 note.)
- Which 8 patterns from the Intigo memo become the seed catalog, and in what file shape? (Reconcile with [INVESTIGATORS.md](./INVESTIGATORS.md).)
- Where does the semantic layer live in the current repo structure? Today there is no `packages/semantic-layer` — needs a home before onboarding can ship.
