# Target Architecture (North Star)

> Captured 2026-05-12. This is the **target** architecture Argus is being designed toward — the venture-grade endpoint that supports multi-tenant SaaS, enterprise on-prem, multi-LLM, and the trust pipeline that makes CFOs sign.
>
> [ARCHITECTURE.md](./ARCHITECTURE.md) describes the **current** v0.1 implementation (TypeScript monorepo, Fastify + BullMQ + Postgres). This document describes where we're going. Where the two disagree, `ARCHITECTURE.md` is what runs today; this doc is what we're moving toward — and the gap is intentional.
>
> Companion to [STRATEGY.md](./STRATEGY.md). The architecture flows directly from the strategy: a playbook catalog, a sizing engine, executive memos, BYO-DB + BYO-LLM, and a hard trust guarantee.

---

## North star: three planes, one rule

```
┌──────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE                                                    │
│  Shared. Cheap to run. Holds nothing sensitive.                   │
│  Auth · Billing · Playbook catalog · Tenant registry · Audit log  │
└──────────────────────────────────────────────────────────────────┘
            │ orchestrates                  │ reads playbooks
            ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  DATA PLANE  (one per tenant in enterprise, pooled in starter)    │
│  Holds: semantic layer, connection creds (encrypted), findings,   │
│         memos, query receipts, schema cache.                      │
│  Talks to: customer DBs, external data sources.                   │
└──────────────────────────────────────────────────────────────────┘
            │ tool-calls                    │ embeddings
            ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  INFERENCE PLANE                                                  │
│  LLM router, prompt cache, embedding store, agent runtime.        │
│  Stateless. Horizontally scalable. Provider-agnostic.             │
└──────────────────────────────────────────────────────────────────┘
```

**The rule:**

- The **Control Plane** never sees customer data.
- The **Inference Plane** never persists customer data.
- Only the **Data Plane** holds tenant rows, and any single tenant's Data Plane can be lifted into its own VPC/region whenever the contract demands it.

Design this in on day one. Retrofitting is a 6-month project that loses enterprise deals.

---

## Control Plane

Single Postgres (with RLS), Next.js/FastAPI frontend, no special tricks.

| Table | Purpose |
|---|---|
| `tenants` | id, tier, region, isolation_mode (pooled / silo / on-prem) |
| `users` + `memberships` | who can see what |
| `playbooks` | the shared catalog — YAML compiled to JSONB |
| `playbook_versions` | semver, rollback, A/B per tenant |
| `connections` | tenant → DB endpoint pointers (creds encrypted with per-tenant DEK, master KMS key) |
| `schedules` | cron expressions per tenant per playbook |
| `audit_log` | every prompt, query, memo (hash-chained, append-only) |
| `billing_usage` | rows-scanned, tokens-spent, memos-shipped |

**Why one shared Postgres for control:** nothing here is sensitive, and it lets us ship features without coordinating across tenants.

**The thing we'd be tempted to put here but shouldn't:** tenant query results. Those belong in the Data Plane.

---

## Data Plane

This is the hard part. Three deployment modes, **same code**:

| Mode | Who | Architecture |
|---|---|---|
| **Pooled** | Starter (€499) | One Postgres + S3, RLS by `tenant_id` |
| **Silo** | Growth (€1.5k) | Dedicated Postgres + S3 bucket per tenant |
| **On-prem / VPC** | Enterprise (€4k+) | Customer's cloud, Docker Compose / Helm chart |

Same Docker image runs in all three modes. The difference is just terraform.

### What the Data Plane holds (per tenant)

```
data_plane/
├── postgres/
│   ├── semantic_layer        ← canonical concepts → tenant schema mappings
│   ├── playbook_runs         ← workflow state, results
│   ├── findings              ← each opportunity, sized, scored
│   ├── memos                 ← composed reports
│   ├── query_receipts        ← every SQL + result row, for traceability
│   └── connection_secrets    ← KMS-encrypted DB creds
├── object_store (S3/MinIO)/
│   ├── memo_pdfs/
│   ├── attached_charts/
│   └── result_snapshots/     ← large query results don't bloat Postgres
└── redis/
    ├── schema_cache          ← introspected DB schema, 24h TTL
    └── result_cache          ← keyed by SQL hash, 30m TTL
```

### Connector layer

One interface, many adapters. Don't try to be clever.

```python
class Connector(Protocol):
    kind: Literal["postgres","mysql","snowflake","bigquery","sqlite","mongo","duckdb","clickhouse","mssql"]
    capabilities: Capabilities   # supports_window_fns, supports_cte, max_query_bytes, etc.

    async def introspect(self) -> SchemaGraph: ...
    async def sample(self, table: str, n: int = 5) -> list[dict]: ...
    async def execute(self, sql: str, *, timeout_s: int = 30, max_rows: int = 50_000) -> ResultSet: ...
    async def explain(self, sql: str) -> CostEstimate: ...
```

Every adapter wraps the customer connection in a **safety harness**:

```python
async def execute(self, sql: str, ...) -> ResultSet:
    async with self.pool.acquire() as conn:
        await conn.execute("SET statement_timeout = '30s'")
        await conn.execute("SET lock_timeout = '5s'")
        await conn.execute("SET idle_in_transaction_session_timeout = '10s'")
        await conn.execute("BEGIN READ ONLY")
        try:
            rows = await conn.fetch(sql)        # asyncpg / sqlalchemy
            if len(rows) > max_rows:
                raise ResultTooLarge(len(rows))
            return ResultSet(rows, sql=sql, hash=sha256(sql))
        finally:
            await conn.execute("ROLLBACK")     # zero side effects guaranteed
```

For Snowflake/BigQuery, **cost gating**: refuse to run a query estimated at > N TB scanned without explicit approval. Customers will love us for it.

**Non-negotiable rules baked into the harness:**

1. Read-only DB role at the customer's side, allow-listed schemas.
2. Statement timeout always set, never disabled.
3. Every executed SQL is hashed and persisted **before** execution (the `query_receipt`).
4. Results truncated to N rows; full set goes to object store with a signed URL.

### Semantic layer — the thing that makes multi-DB actually work

This is our highest-leverage IP after the playbook catalog. It maps **canonical concepts** to tenant-specific schema.

```yaml
# data_plane: semantic_layer/tenant_intigo.yaml
concepts:
  Revenue:
    entity_table: finance_expediteurinvoice
    amount_column: total_amount
    tax_column: tva
    timestamp_column: created_at
    customer_fk: business_id
    void_filter: "is_void = false"
    legacy_unions:
      - {table: comptabilite_bill2022, amount: net_amount, date: created_at}
      - {table: comptabilite_bill2023, amount: net_amount, date: created_at}
      - {table: comptabilite_bill2024, amount: net_amount, date: created_at}

  Expense:
    base_table: expenses_expensebase
    amount_column: amount_to_pay
    timestamp_column: "COALESCE(payment_date, created_at::date)"
    subtypes:
      - expenses_parcexpense
      - expenses_officeexpense

  Customer:
    table: expediteurs_business
    id: id
    name: "COALESCE(NULLIF(nom_commercial,''), name, raison_sociale)"

  Order:
    table: logistics_parcel
    amount: price
    customer_fk: business_id
    status: status
    status_map: {delivered: [5000], returned: [6001,6900,6000], lost: [9004,9005,9006]}
```

**Two big wins from this design:**

- Every playbook is written against `Revenue`, `Customer`, `Order` — not table names. The same playbook runs on Intigo, on a Lyon SaaS, on a Cairo marketplace.
- A non-engineer can do onboarding via a wizard. *"Where do refunds live?"* → dropdown of tables + columns. This is what makes the product sellable. Treat this YAML as the customer's most precious config; version it, diff it, let them approve every change.

### Playbook = pattern, not a query

```yaml
# control_plane: playbooks/concentration_risk.yaml
id: concentration_risk
version: 1.3.0
domain: [marketplace, logistics, b2b_saas]
requires_concepts: [Revenue, Customer]
schedule_default: weekly

hypothesis: |
  Losing any single large customer would materially impact monthly revenue.

detection:
  sql_template: |
    WITH per_customer AS (
      SELECT {{Customer.name}} AS name,
             SUM({{Revenue.amount}}) AS rev
      FROM   {{Revenue.entity_table}}
      WHERE  {{Revenue.timestamp}} >= NOW() - INTERVAL '{{lookback_days}} days'
        AND  {{Revenue.void_filter}}
      GROUP BY 1
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY rev DESC) AS rk,
                       SUM(rev) OVER () AS total FROM per_customer)
    SELECT rk, name, rev, total, rev/total AS share
    FROM ranked WHERE rk <= {{top_n}};

  params:
    lookback_days: 150
    top_n: 25

severity:
  rules:
    - if: "rows[0].share > 0.15"
      level: critical
      headline: "{{rows[0].name}} alone is {{ pct(rows[0].share) }} of revenue"
    - if: "sum(rows[:10].share) > 0.5"
      level: high
      headline: "Top 10 customers = {{ pct(sum(rows[:10].share)) }} of revenue"

sizing:
  defensive: true                  # not "this much money to gain"
  exposure: "rows[0].rev"          # what you'd lose

recommended_actions:
  - lock_top_n_with_volume_commits
  - diversify_outbound_to_mid_tail
```

**Three things to notice:**

1. The SQL is a **template** parameterized by the semantic layer. Same template, runs on any DB whose semantic layer is mapped.
2. Severity is **rule-based, not LLM-based.** Numbers are deterministic. The LLM writes prose, not math.
3. Sizing is **explicit.** No "this looks important." Every finding ships with a monetary number.

Build 30 of these. That's a year-1 catalog. See [INVESTIGATORS.md](./INVESTIGATORS.md) for the runtime form.

---

## Inference Plane

Three jobs: **route, cache, supervise.**

### LLM router

Three tiers per task class:

```python
ROUTING = {
    # Heavy thinking, plan-the-run, complex synthesis
    "planner":  ["claude-opus-4-7", "gpt-5", "gemini-2.5-pro"],
    # SQL gen, classification, structured extraction
    "worker":   ["claude-sonnet-4-6", "gpt-5-mini", "gemini-2.5-flash"],
    # Summarize, format, polish
    "bulk":     ["claude-haiku-4-5", "gpt-5-nano", "local:qwen-3-32b"],
}

def pick(task: TaskType, tenant: Tenant) -> ModelID:
    tier = TIER_OF[task]
    # 1. tenant override (some enterprises require local-only)
    if tenant.llm_policy.local_only:
        return pick_local(tier)
    # 2. budget gate
    if tenant.budget_remaining_pct() < 0.1 and tier != "planner":
        return downgrade(tier)
    # 3. provider preference + health check
    for model in ROUTING[tier]:
        if model_health.ok(model) and tenant.allows(model):
            return model
    raise NoModelAvailable()
```

**Key decisions:**

- **Don't use LangChain.** Use SDKs directly. When debugging at 11pm, you'll thank yourself.
- Provider fallback is automatic **but logged.** If Claude is down and the run falls to GPT, the memo says so in the receipt panel.
- Tenant-level policies: `local_only`, `eu_residency_only`, `no_openai`. **Sell this** — finance teams will pay for it.

See also [AI_PROVIDERS.md](./AI_PROVIDERS.md) for the current provider abstraction.

### Prompt cache strategy

The biggest cost lever. Three layers:

1. **Provider-native cache** (Anthropic prompt caching, Gemini implicit caching). The system prompt for each playbook = playbook YAML + semantic layer YAML + style guide. Same every run → **80–95% cost cut.**
2. **Result cache** (Redis, keyed by SQL hash + tenant + date bucket). When two playbooks fetch overlapping data, the second pays nothing.
3. **Memo template cache** (S3, content-addressed). The same finding produces the same prose; only the dynamic numbers change. Compose with templates, not freeform generation, for the boilerplate sections.

### Agent runtime

Most "multi-agent systems" are overengineered. The actual graph for one memo run:

```
┌──────────────┐
│ Orchestrator │  ← decides which playbooks to run (cost vs schedule vs alert state)
└──────┬───────┘
       │  fan-out
       ▼
┌───────────────────────────────────────────────────────────┐
│  Per-playbook subgraph (parallel)                          │
│                                                            │
│   ┌────────────┐    ┌──────────┐    ┌─────────────────┐   │
│   │ SQL Author │ →  │ Executor │ →  │ Result Validator│   │
│   └────────────┘    └──────────┘    └────────┬────────┘   │
│         ↑                                     │            │
│         │  retry on error (max 3)            │            │
│         └─────────── error feedback ◄─────────┘            │
│                                              │            │
│                                              ▼            │
│                                      ┌───────────────┐    │
│                                      │ Analyst (LLM) │    │
│                                      │ sizes, scores │    │
│                                      └───────┬───────┘    │
│                                              │ (optional) │
│                                              ▼            │
│                                  ┌─────────────────────┐  │
│                                  │ External Context    │  │
│                                  │ (news/FX/weather)   │  │
│                                  └──────────┬──────────┘  │
└─────────────────────────────────────────────┼─────────────┘
                                              │ fan-in
                                              ▼
                                    ┌──────────────────┐
                                    │ Composer (LLM)   │
                                    │ prioritizes,     │
                                    │ writes memo      │
                                    └────────┬─────────┘
                                              ▼
                                    ┌──────────────────┐
                                    │ Critic (LLM)     │
                                    │ checks each #    │
                                    │ vs SQL receipt   │
                                    └────────┬─────────┘
                                              ▼
                                    ┌──────────────────┐
                                    │ Delivery         │
                                    │ Slack/Email/PDF  │
                                    └──────────────────┘
```

Each agent is **one tool-using LLM call** with a small focused prompt, not a separate service. The "graph" is just a Python function that calls them in order with retries.

Run it on **Temporal or Inngest**:

- Long-running (memo for big customer can take 10+ minutes)
- Retryable on LLM/DB failures
- Resumable (don't re-run finished playbooks after a transient crash)
- Auditable (Temporal UI = free workflow inspector)

> The **Critic** is the most underrated agent. Its only job: take the composed memo + the query receipts, ask *"does every number in the prose match a row in a receipt?"* If anything is off, kick back to the Composer with a diff. **This is what kills hallucinated numbers — the #1 trust killer.**

---

## External plugins (news / FX / stocks / weather)

Same interface as connectors, simpler shape:

```python
class ContextPlugin(Protocol):
    name: str
    triggers: list[str]                  # which finding types invoke this plugin
    rate_limit_per_tenant: int

    async def fetch(self, finding: Finding) -> list[Citation]: ...

class Citation(BaseModel):
    source: str       # "Reuters", "Open-Meteo", "Polygon"
    url: str
    snippet: str
    published_at: datetime | None
    confidence: float
```

**Day-1 plugins:**

- **News**: Tavily search → Anthropic web search → fallback NewsAPI. Triggered by macro findings (fuel cost spike, inflation, supply chain).
- **FX**: exchangerate-api.io. Triggered when revenue is in foreign currency.
- **Weather**: Open-Meteo (free). Triggered by ops/delivery findings tied to dates.
- **Public equities/commodities**: Polygon.io. Triggered by industry comparisons.

**Responsibility chain:** the Composer doesn't fetch — the per-playbook Analyst does, then injects a `<citation>` block. The Composer just renders.

---

## Observability — the part that saves your nights

Three streams, three tools, one query language:

| Stream | Tool | What it captures |
|---|---|---|
| LLM traces | Langfuse (self-host) | Every prompt, completion, latency, cost, retries |
| App + DB | OpenTelemetry → Grafana Tempo + Loki | HTTP traces, slow queries, errors |
| Business | Postgres + Metabase | Memos shipped, opportunities-sized total, tenant churn signal |

**Single `tenant_id` propagated as a span attribute everywhere.** When a customer says "the memo is wrong" you grep for their tenant_id and see the whole chain in 30 seconds.

Specifically log:

- **Cost per memo** (tokens × model price + DB query time) → unit economics dashboard
- **Hallucination rate** (Critic rejections / total findings) → product quality metric
- **Time-to-memo** (P50, P95) → service quality
- **Schema drift events** (semantic layer mapping failed) → onboarding friction signal

---

## Security architecture

Skip this and we can't sell to anyone serious.

```
┌─────────────────────────────────────────────────────┐
│  Browser ── TLS 1.3 ──▶ Edge (Cloudflare WAF)        │
│                          │                            │
│                          ▼                            │
│  Control Plane API ◄── mTLS ──▶ Data Plane API       │
│                          │                            │
│                          ▼                            │
│  KMS (envelope encrypt)  ── per-tenant DEK ──▶ DB    │
│                          │                            │
│                          ▼                            │
│  Customer DB connection over IP-allowlisted egress    │
│  (or AWS PrivateLink / VPC peering for enterprise)   │
└─────────────────────────────────────────────────────┘
```

**Concrete commitments to put on a sales page:**

- **Read-only DB role, allow-listed schemas.** We refuse to onboard if the role has write.
- Customer credentials encrypted at rest with a **per-tenant data key, rotated quarterly.** Decryption key is in cloud KMS, never in app memory beyond the SQL execution.
- **Audit log is append-only and hash-chained.** A regulator can verify nothing was tampered.
- **PII redaction in prompts**: optional mode where rows go into the LLM as schema + aggregates, never raw values. Costs some quality, satisfies most paranoid CFOs.
- **SOC 2 Type 1 in year 1, Type 2 in year 2.** Don't bother arguing this — every enterprise asks.
- **On-prem deployment**: Docker Compose for dev, Helm chart for prod, vLLM-served Llama/Qwen for the LLM if they refuse cloud LLMs.

---

## Scaling profile

What breaks first as we grow:

| Tenants | What breaks | Fix |
|---|---|---|
| 1–10 | Nothing | Single region, single Postgres, Temporal Cloud |
| 10–50 | Schema cache contention | Move to Redis Cluster, partition by tenant |
| 50–200 | Postgres write IOPS on `query_receipts` | Move receipts to ClickHouse |
| 200–500 | LLM cost | Increase prompt cache hit rate, push more to local models |
| 500+ | Regional latency, compliance | Multi-region Data Plane, EU/US/MENA cells |

**We will not hit these problems for 18 months. Do not pre-optimize.** Build the cleanest possible monolith on the Data Plane and refactor when a real customer forces us to.

---

## What to build first (concrete, in order)

| Week | Build | Why |
|---|---|---|
| 1 | Connector interface + Postgres adapter + the safety harness | The thing we'll regret if we skimp on |
| 2 | Semantic layer YAML schema + loader + template renderer | Unlocks multi-DB from day one |
| 3 | Playbook YAML format + 3 playbooks (concentration, pricing leak, sleeping giants) | Proves the loop end-to-end |
| 4 | LLM router (Claude + GPT) with prompt caching | Cost gate before we ship demos |
| 5 | Temporal workflow tying it all together | The orchestration spine |
| 6 | Critic agent + query receipts UI | The trust layer |
| 7 | Email + Slack delivery, basic auth & billing | Now it's a product |
| 8 | Onboard 2 design partners, fix what breaks | Real signal |

**Skip until later:** GraphQL APIs, Kubernetes, custom auth (use Clerk/WorkOS), mobile, multi-region. Every one of those is a trap for an 8-week-old product.

---

## The single most important decision

**Optimize ruthlessly for the trust pipeline: query receipt → critic agent → linked numbers in the memo.**

Everything else can be janky in V1. If a CFO clicks a number in the memo and sees the exact SQL that produced it, we've won. If they spot one hallucinated figure in week 1, we'll never sell to them again. This is why the Critic agent and the receipt UI come **before** the dashboards, before the chat interface, before the pretty PDF templates.

---

## Reconciliation with the current implementation

The current [ARCHITECTURE.md](./ARCHITECTURE.md) describes a TypeScript monorepo: Fastify API, BullMQ workers, Next.js dashboard, Postgres + Redis, AI provider abstraction. That stack is good for v0.1 and already overlaps with the target on several points (provider abstraction, Postgres-as-primary, no K8s, executive surface).

The gaps to close, in order of impact:

1. **Three-plane separation.** Today everything lives in one logical plane. The Control / Data / Inference split has to be a refactor target before we onboard enterprise tenants.
2. **Semantic layer.** No `packages/semantic-layer` exists yet. This is the highest-leverage IP and the bottleneck for "second tenant onboards in <1 hour."
3. **Playbook YAML.** [INVESTIGATORS.md](./INVESTIGATORS.md) defines investigators in TS; the target wants declarative YAML playbooks with templated SQL bound to semantic concepts. Decide whether playbooks compile *to* investigators, or replace them.
4. **Critic agent + query receipts.** Today there is no Critic. Every number in every memo should be traceable to a hashed SQL receipt before we sell to a CFO.
5. **LLM router with cost/health/policy routing.** The current provider abstraction picks one model; the target routes per task tier with budget gating and tenant policies.
6. **Python vs. TypeScript.** [STRATEGY.md §4](./STRATEGY.md) flags the same tension. Open question: does the data-engine path (connectors, semantic layer, playbook executor, agent runtime) move to Python, or stay TS? Most of the SQL/LLM ecosystem is Python; the existing surface is TS. Worth a deliberate decision before week 1 of the build plan above.
