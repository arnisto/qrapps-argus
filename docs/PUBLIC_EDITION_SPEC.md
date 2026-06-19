# Argus — Public Edition Spec (v0.3, advisor-refined)

> **Status:** v0.3 — refined from v0.2 after a 6-advisor panel (cofounder, product-owner, principal-engineer, software-architect, gtm, legal-compliance). The panel **did not endorse the pivot itself**; this spec exists for the case where the author chooses to proceed anyway, with the panel's input incorporated. See §0 for the unresolved strategic question.
>
> **Author:** Lamjed Gaidi · **Date:** 2026-05-22

---

## 0. The unresolved strategic question (read this first)

The author already has a working product in this repo: the **Argus Autopilot** (`mvp/argus_roi/autopilot/`), an autonomous LLM-driven SQL ROI engine that has surfaced ~2M TND of real exposure at a real Tunisian logistics company (Intigo). It has a buyer in the building (Bassem, Intigo CEO) and zero monetization attempts to date.

This spec describes a **different product**, not v2 of the autopilot: an open-source self-hostable "company brain" that drafts replies to social-media inbounds. Different stack, different buyer, different wedge, different distribution motion.

**A solo dev cannot maintain both.** The recommended first action — endorsed by the panel — is **not** to build this spec. It is to send Bassem the existing autopilot memo this week and book a 20-minute call. If that yields a paying design partner in 30 days, this spec stays parked.

The rest of this document assumes the author chooses to proceed anyway, OR proceeds to validation (§13) first.

---

## 1. Positioning (rewritten per GTM)

**One-line (sharper than v0.2):**

> *"Open-source, self-hosted drafter that reads your files and DBs to write grounded replies for your inbound DMs — your team approves before send."*

**What it is** *(panel-validated)*: a draft-and-approve layer over a private knowledge core, free to self-host, paid in the cloud.

**What it explicitly is NOT:**
- A chat-with-your-DB tool (Onyx, MotherDuck Spongey already do this).
- A general agent platform.
- An autonomous reply bot.

**The two wedges, honestly framed:**

1. **Draft-and-approve for social inboxes** — Onyx is search/chat; Argus is **the draft layer**. This is the verb Onyx doesn't own.
2. **MENA-first localisation** — Darija/Arabic UX and prompt patterns. **Positioning, not revenue.** Reachable TAM is small (200–600 SMEs). Use it for PR + founder story; don't price it.

**The wedge that v0.2 claimed but is NOT real:** "active interview loop" as a technical moat. Per the principal engineer: it's ~300 LOC of clever prompting, Onyx can clone it in a sprint. The *real* moat is the **data flywheel** — answered Q&A accumulates inside the tenant's instance, becoming the corpus competitors can't replicate. Frame Slice 2 around that flywheel metric ("by month 3, ≥40% of grounded drafts cite a `qa`-sourced fact"), not around the loop mechanic.

---

## 2. Slice 1 (TRUE MVP — cut per Product Owner)

The v0.2 §2.2 was three slices stuffed into one. v0.3 ships only this:

| In Slice 1 | Out of Slice 1 (later or never) |
|---|---|
| `docker compose up` → FastAPI + Postgres/pgvector + LiteLLM + Redis + 1 worker | **Facebook adapter** (Meta App Review tax for unvalidated demand) |
| Files-only ingestion: drop into `./inbox/`, embed on poll | DB connector |
| Generic `POST /webhook/inbound` (curl-able) | Slack notification adapter |
| Classifier → retriever → drafter → row in `drafts` table | Admin UI beyond the inbox |
| **Single approval surface**: one HTMX page at `/inbox` listing pending drafts with Approve / Edit / Reject | Q&A UI (table stub only) |
| Approve → POST to a user-supplied `reply_webhook_url` | Knowledge graph |
| Append-only audit log | Darija marketing (ships free with whatever model the user wires) |
| README with a ≤15-minute quickstart | Multi-tenancy plumbing beyond `tenant_id` columns |

**One-sentence acceptance test** (replaces v0.2's six bullets):

> *"A developer who has never seen the repo can, in under 15 minutes following only the README, `docker compose up`, `curl` a fake inbound message, see a grounded draft citing a file they dropped in `./inbox/`, click Approve, and observe the reply POST hit their own webhook — with the entire exchange in the audit log."*

---

## 3. Architecture (revised per Software Architect)

```
                   Config (YAML + .env: LLM keys, channel webhooks, retention)
                                       │   nothing hard-coded
   ┌───────────────────────────────────┼────────────────────────────────┐
   ▼                                   ▼                                ▼
File watcher                  POST /webhook/inbound              HTMX /inbox
(./inbox/*)                   (generic, signed)                  approval UI
   │                                   │                                ▲
   └────► Normalizer ──┐               │                                │
                       ▼               ▼                                │
                   pgvector facts     message_events                    │
                   (+ entity edges)        │                            │
                                           ▼                            │
                                    enqueue 'draft' job                 │
                                           │                            │
              ┌────────────────────────────┴───────────────────────┐    │
              ▼          ▼            ▼              ▼             ▼    │
          classifier  retriever    drafter      audit_log     decision──┘ on approve
              (LLM via LiteLLM)                                  │
                                                                 ▼
                                                          enqueue 'send'
                                                                 ▼
                                                       outbound adapter
                                                                 │
                                                                 ▼
                                                       sent_messages
```

### 3.1 Stack (locked)

| Layer | Choice | Notes (per advisors) |
|---|---|---|
| API | **FastAPI (async)** + HTMX | Auto OpenAPI; HTMX inbox avoids Next.js sprawl |
| Store | **Postgres 16 + pgvector + RLS** | RLS from day 1, not just `tenant_id` column |
| Embeddings index | composite `(tenant_id, embedding) ivfflat` | Namespaced; cross-tenant recall = 0 |
| LLM gateway | **LiteLLM** | Provider-agnostic; user supplies keys |
| Queue | **Redis + Arq** (or RQ) | Stages = functions, NOT services. No Temporal until tenant N is real. |
| Local model (opt-in) | **Ollama (Qwen-3 / Gemma-2)** | For Darija + fully-local users |
| Packaging | **Docker Compose** | "15 minute quickstart" is the hard acceptance criterion |
| Secrets | `tenant_secret` table referencing env or KMS | NEVER `.env` for tenant creds (Phase B-ready) |
| Migrations | Alembic | One source of truth |

### 3.2 Concurrency (per Architect §4)

- `/webhook/inbound`: verify signature → insert `message_event` → enqueue `draft` job → return 200 in <500ms (FB retries on >20s; harmless here, real for Phase B).
- `draft` worker: classify → retrieve → draft → insert `draft` row → notify approval surface. **Idempotent on `message_event_id`.**
- Approval: `POST /decision/{draft_id}` → insert `decision` → enqueue `send`.
- `send` worker: dispatch via outbound adapter → insert `sent_message`.

**The human pause is just "no `send` job exists until a `decision` row is inserted."** No long-lived workflow engine.

### 3.3 Adapter contracts (locked)

```python
class InboundChannelAdapter(Protocol):
    name: str
    async def verify(self, request: Request) -> bool: ...
    async def parse(self, request: Request) -> list[InboundMessage]: ...
    async def ack(self, msg: InboundMessage) -> None: ...

class OutboundChannelAdapter(Protocol):
    name: str
    async def send(self, recipient_ref: str, text: str) -> str: ...  # returns external_send_id
```

**`InboundMessage`** is a Pydantic DTO: `external_id, sender_ref, text, lang_hint, received_at, raw_payload`.

**MUST NOT** appear in either interface: classification, drafting, storage, LLM, tenant, or anything from the opposite direction. Inbound and outbound are separate adapters even for the same channel.

---

## 4. Data model (refined per Principal Engineer)

```sql
-- baseline tables (v0.2 had these; refined column lists)
tenant                  (id, name, created_at)

knowledge_fact (
  id, tenant_id, content, embedding vector(1536),
  source_type   text,           -- 'file' | 'db' | 'qa' | 'social'
  source_ref    text,           -- e.g. file path, table.row, qa_id
  entity_id     bigint,         -- NEW: link to entity for "what do we know about X"
  slot_key      text,           -- NEW: e.g. 'sla.shipping_hours' for dedup/decay
  authority_rank smallint,      -- NEW: db=100, qa=80, file=40 — fixes contradictions
  scope_predicate jsonb,        -- NEW: {"customer_tier": "vip"} for scoped facts
  source_trust   real,          -- 0-1 derived from source_type
  freshness_at   timestamptz,   -- last seen / refreshed
  valid_until    timestamptz,
  derived_from_fact_ids bigint[], -- lineage so qa derived from stale file is flagged
  created_at     timestamptz
);
CREATE UNIQUE INDEX ON knowledge_fact (tenant_id, entity_id, slot_key, (scope_predicate::text));

knowledge_gap (
  id, tenant_id,
  cluster_key   text,           -- NEW: groups recurring gaps (question-pattern hash)
  evidence_message_ids bigint[],-- which inbounds revealed the gap
  status        text,           -- 'open' | 'asked' | 'answered' | 'stale'
  question_text text,
  asked_at, answered_at
);

entity (
  id, tenant_id, kind, canonical_name
);
entity_relation (
  tenant_id, src bigint, dst bigint, kind text, fact_id bigint, confidence real
);

message_event (
  id, tenant_id, channel, external_id, sender_ref, raw_text, lang,
  intent_class, intent_risk, urgency, received_at
);

draft (
  id, message_event_id, draft_text, model_used,
  grounded_fact_ids bigint[], confidence,
  status text DEFAULT 'pending',  -- 'pending' | 'failed' | 'sent' | 'rejected'
  error  text                     -- visible failure (architect §6)
);

decision (
  id, draft_id, action text, edited_text, actor, decided_at
);

sent_message (
  id, decision_id, channel, external_send_id, sent_at
);

audit_log (id, tenant_id, kind, payload jsonb, hash, prev_hash, created_at);  -- hash-chained
```

**Confidence routing — replaces v0.2's single threshold (per Principal Engineer):**

```
route_decision = policy_table[intent_risk_class][min(source_trust, freshness_score)]
# 3 × 3 table: low/med/high risk × low/med/high evidence
# Output: 'answer' | 'hedge' | 'escalate'
# Editable per tenant, auditable.
```

**Contradiction resolution:** when multiple facts match a slot+scope, return all ranked by `authority_rank × freshness × scope_specificity`, **show the conflict to the human in the approval UI**, drafter cites the winner. Silent picking = silent corruption of customer promises.

---

## 5. Guardrails (rewritten per Legal)

1. **No public send without human approval.** Default, non-overridable in Phase A.
2. **Grounded-only drafting.** Below routing-policy threshold → hedge or escalate, never invent.
3. **Read-only DB ingestion.** Zero write capability on source DBs. Write-keyword regex + `BEGIN READ ONLY` + `statement_timeout`.
4. **Your data stays on your infrastructure UNLESS you wire a remote LLM or channel.** (Replaces v0.2's misleading "never leaves your machine.") The active LLM endpoint name + "prompts leave the host: YES / NO" is shown on every page header and the startup banner.
5. **No hard-coded secrets or endpoints.** All user-supplied via `.env` + tenant_secret table.
6. **No default Meta app_id** ever ships with this repo. Self-hoster creates their own Meta developer account and accepts Meta Platform Terms themselves. (Per Legal: this is the single biggest legal risk if violated.)
7. **Append-only audit log, hash-chained.** Crypto-shredding (per-subject key) reconciles with GDPR right-to-erasure without breaking the chain.

---

## 6. Open decisions — NOW LOCKED

| # | Decision | Locked choice | Why |
|---|---|---|---|
| 1 | **License** | **AGPL-3.0** + **Apache-style CLA** | Defends open-core-with-paid-SaaS against AWS-style rehosting (Mongo/Elastic precedent); CLA preserves future dual-license option (Legal) |
| 2 | **Repo strategy** | **Separate repo** (`argus-public`), monorepo internally (`engine/`, `adapters/...`) | The autopilot is unrelated code; co-habiting pollutes public history and violates "nothing Intigo-specific" (Architect) |
| 3 | **Reference channel** | **Generic webhook only in Slice 1.** Facebook deferred to Slice 1.5 after Meta App Review. | PO + Legal both flagged Meta App Review as a multi-week tax for unvalidated demand |
| 4 | **Confidence "threshold"** | **3×3 policy table** (intent_risk × min(trust, freshness)) per tenant. No single scalar. | Principal Engineer §3 — single threshold oscillates and conflates incompatible signals |
| 5 | **Project name** | **TBD before first public commit.** "Argus" is heavily taken (Apache Argus is the Hadoop security project, plus the autopilot already uses it). Pick something free and trademark-checkable. | Architect §7 — name + license are the only truly irreversible decisions |
| 6 | **Distribution motion** | **Self-host = lead-gen funnel into hosted SaaS (€99–€299/mo)** | GTM §2 — "sell it for free" is fine as acquisition, not strategy. Hosted SaaS is ~80% of realistic revenue months 6–12 |

---

## 7. Roadmap (revised)

| Slice | Scope | DoD |
|---|---|---|
| **1 (4–6 wk)** | TRUE MVP above. Webhook + files + drafter + approve + audit. Generic outbound webhook. | 15-min quickstart acceptance test passes for an outsider |
| **1.5 (2 wk)** | Slack inbound + Slack approval (real CS use case). Facebook adapter starts Meta App Review in parallel. | First non-author user runs it in production on Slack |
| **2 (3–4 wk) — the wedge** | **Question-pattern mining** gap detector (1 of 4 detector types per Principal Engineer — the only demand-weighted one). Weekly digest email of top-5 gap clusters. Q&A answer flow. Fact freshness/decay. Contradiction resolver UI surfacing. | Flywheel metric: ≥30% of drafts cite a `qa`-sourced fact in tenant's month 3 |
| **3** | More channels (IG, WhatsApp, X) via adapter interface. DB connector ingestion (read-only). | — |
| **4** | Tiered autonomy: opt-in auto-send on whitelisted FAQ intent class only. | — |
| **Phase B (cloud)** | Multi-tenancy turned on (RLS already there). Hosted onboarding. Non-technical wizard. Billing. | First paying SaaS customer |
| **Paid extras (Phase B)** | Hosted SaaS · Team RBAC · Managed Darija model · Priority support. **Cut from pricing page**: multi-LLM router (LiteLLM is free; nobody pays). | — |

---

## 8. Distribution playbook (per GTM §5–§7)

**Launch day artifact** — the one thing that actually travels:

- **60-second screen recording**: drop a file → curl a fake inbound → see grounded draft → click Approve → reply hits a webhook. *Watch-it-work GIF beats a polished README every time.*

**Day-1 channels** (named):

1. **r/selfhosted + r/homelab** — personal story angle ("self-hosted a CS drafter for my dad's shop"), GIF demo, AGPL in the title. Target: 20–40 trials.
2. **Hacker News Show HN** — Tuesday 9am ET. Title: "Show HN: <name> — self-hosted draft-and-approve for Facebook/Instagram DMs." Darija angle is paragraph 3, not the title.
3. **MENA founder Slacks/Discords** (Flat6Labs alumni, Tunisia Startup Community, Morocco StartupYourLife, Cairo Angels founders). Warm DM, founder-to-founder.

**Channels to skip entirely:** r/programming (gets eaten on AI-slop grounds), Twitter/X (low conversion, performative), Product Hunt (saturated for OSS).

**The anti-distribution pitfall** *(GTM §6)*: writing more docs instead of shipping the demo video. Polishing a logo. r/programming.

---

## 9. Privacy & compliance (per Legal)

**README MUST state, prominently:**

- "Not legal advice; you are the data controller."
- Active LLM endpoint name + whether prompts leave the host.
- "Bring your own Meta app_id and accept Meta Platform Terms yourself" (no default app).
- How to run `erase --subject <id>`, `export --subject <id>`, `purge` CLIs.
- Retention defaults per `source_type`.
- Required `SUBPROCESSORS.md` and privacy-notice templates ship in `docs/templates/`.
- EU AI Act Art. 50 disclosure obligation for any EU end-user-facing reply.
- Encryption-at-rest is the operator's job; `pgcrypto` knobs documented.

**Crypto-shredding** for GDPR erasure: per-subject encryption key in `kms_keys` table; deleting the key erases the data without breaking the hash chain. Reference: EDPB Guidelines 02/2023.

---

## 10. Multi-tenant readiness (what `tenant_id` ALONE doesn't give you)

Per Software Architect — these are the things that *actually* make Phase B a config flip (vs a rewrite):

1. **Postgres RLS policies** on every tenant-scoped table, enforced via session-level `SET app.tenant_id = ...` in psycopg pool init.
2. **`tenant_secret` table** for LLM keys/channel creds/webhook secrets. Never `.env` for tenant data.
3. **Per-tenant rate-limit + cost accounting** on the LiteLLM gateway. One tenant nukes everyone's Gemini quota otherwise.
4. **Namespaced embeddings**: composite `(tenant_id, embedding) ivfflat` index, not post-hoc filter.
5. **Tenant-keyed background jobs**: queue payload always carries tenant_id, workers respect it for fair scheduling.

All five ship in Slice 1, even with a single hard-coded tenant. They are 1–2 hours each. Skipping them = the painful retrofit the v0.2 doc warned against.

---

## 11. What's explicitly cut from v0.2

| Cut | Why |
|---|---|
| **Facebook Messenger adapter in Slice 1** | Meta App Review = weeks of tax for unvalidated demand. Generic webhook IS the adapter; FB shim later. |
| **Slack notification adapter in Slice 1** | The HTMX `/inbox` page IS the approval surface. Slack is Slice 1.5. |
| **DB connector in Slice 1** | Files prove the loop. DB ingestion in Slice 3. |
| **"Lightweight graph" in Slice 1** | Just two SQL tables (`entity`, `entity_relation`) seeded but not queried. No graph queries in Slice 1. |
| **Admin UI** | `.env` + `config.yaml`. No settings screen. |
| **Q&A entry UI** | Stub the table. Skip the UI. (Built in Slice 2.) |
| **Darija marketing claim** | Free side-effect of whatever model the user wires. Don't claim as a feature until tested with a real Tunisian SME. |
| **Multi-LLM router in pricing** | LiteLLM is free; nobody pays for this. Cut. |

---

## 12. Success criteria (Slice 1)

**One number, not a dashboard:** GitHub stars from non-author accounts within 14 days of the launch post. Target: **30** *(panel-derived baseline).*

**Secondary signals (must all hit before Slice 2):**

- ≥10 unique `docker compose up` runs (anonymous telemetry, opt-in, prominent disclosure).
- ≥1 issue or PR from a non-author (proves real use, not stars).
- ≥3 non-author users hit the approval acceptance test end-to-end.

If primary <10 stars in 14 days, the wedge is dead — kill the spec, return to the autopilot.

---

## 13. The validation step BEFORE writing Slice 1 code (per Product Owner)

Cheapest test that exists, ship before any code:

1. Write a 200-word "Show HN draft" + Typeform: *"Would you self-host this? What channel matters most to you?"*
2. Post in r/selfhosted (NOT r/programming).
3. Target: **25 sign-ups in 7 days.**
4. **<10 sign-ups → the wedge is wrong, kill the spec.** Darija won't save it.

The author's pattern (per Product Owner observing the autopilot) is to build before validating. **Break that pattern here.** This is a 1-day investment that buys a real signal. Without it, Slice 1 is gambling.

---

## 14. The single biggest failure mode (per Principal Engineer §6 — the 3-month regret)

If Slice 1 ships exactly as specified and Slice 2 (the wedge) slips 6 months, the product becomes: *"Onyx with a Facebook adapter and a Darija UI."* That is a *worse* Onyx. The Darija claim alone won't carry it.

**Mitigation, baked into Slice 1:** the *minimum* gap loop — escalation logging + a `weekly_digest` job that emails the top-5 gap clusters — is built in week 4 of Slice 1, not in Slice 2. One extra day of work; it's the only thing that makes the launch story honest about the wedge from day one.

---

## 15. Appendix: what survives unchanged from v0.2

- The architecture diagram shape (just refined component names and adapter contracts).
- Phase A vs Phase B framing.
- `tenant_id` from day one (kept, but ELABORATED — see §10).
- Open-core line (kept, but pricing page cut per §6.6).
- Hash-chained audit log (kept, expanded with crypto-shredding per Legal §9).
- The author owns the strategic call; this spec is panel-refined input, not panel-mandated path.
