he trap in "loop until real value" is that LLMs converge on plausible output very fast and on true output never, unless you force them to. So the architecture below treats value as
a measurable quantity, makes every loop have a falsifiable success criterion, and gives the system the right to fail loudly instead of looping prettily forever.

The two principles everything else follows from

1. The database is the truth oracle, not the model. Every claim must reduce to a SQL row. The LLM proposes; the database disposes. If a finding's numbers cannot be re-derived by
running the receipt SQL, the finding is rejected — no exceptions.

2. Every loop has a scalar value function and a hard stop. Without a scalar to optimize, "loop until value" means "loop forever burning tokens." Each agent loop optimizes one number
and dies when it stops improving for K iterations, when it crosses a threshold, or when it exhausts a budget.

These two principles are unsexy but they are why this architecture works and why a naïve "agent that retries until success" doesn't.

---
Top-level: four nested loops

┌────────────────────────────────────────────────────────────────────┐
│  L4 — META LOOP  (across runs, days/weeks)                          │
│       Learn which playbooks produce real value for this tenant;     │
│       adjust priors, deprecate dead patterns.                       │
└────────────────────────────────────────────────────────────────────┘
   ↑ feedback (CEO accept/reject + 30-day outcome telemetry)
┌────────────────────────────────────────────────────────────────────┐
│  L3 — PORTFOLIO LOOP  (one run = one memo, ~10 min)                 │
│       Pick playbooks → run each → score findings → compose → critic │
└────────────────────────────────────────────────────────────────────┘
                                ↑
┌────────────────────────────────────────────────────────────────────┐
│  L2 — PLAYBOOK LOOP  (one finding, ~30s–2min)                       │
│       Hypothesis → SQL → execute → verify → size → score            │
│       Self-correct on SQL errors, sanity-check on result shape      │
└────────────────────────────────────────────────────────────────────┘
                                ↑
┌────────────────────────────────────────────────────────────────────┐
│  L1 — QUERY LOOP  (one SQL, ~5–20s)                                 │
│       Author → execute → on error: read error, fix, retry (≤3)      │
│       On empty/odd result: hypothesis check (is the data there?)    │
└────────────────────────────────────────────────────────────────────┘

The loops have different objective functions, different budgets, and different stop conditions. They communicate only through structured artefacts (no free-form prompt passing across
 layers). This is what keeps the system debuggable.

---
L1 — Query loop (deterministic correction)

The smallest loop. Single SQL author trying to produce one running query.

┌─────────────────┐
│  SQL Author     │ ←─────── error feedback ──────────┐
│  (LLM, Sonnet)  │                                    │
└────────┬────────┘                                    │
         │                                              │
         ▼                                              │
┌─────────────────┐    fail   ┌────────────────────┐  │
│  Static Linter  │──────────▶│ Error Classifier   │──┘
│  (sqlglot)      │           └────────────────────┘
└────────┬────────┘                  ▲
         │ pass                       │
         ▼                            │
┌─────────────────┐         fail      │
│  Dry-run        │───────────────────┘
│  EXPLAIN (read- │
│  only sandbox)  │
└────────┬────────┘
         │ pass
         ▼
┌─────────────────┐
│  Bounded exec   │
│  (timeout 30s,  │
│  max 50k rows)  │
└─────────────────┘

Value function: Boolean — did the SQL return a valid result set matching the playbook's output_shape contract?

Auto-correction inputs given to the LLM on retry:

class QueryError:
    sql_attempted: str
    failure_kind: Literal["syntax", "missing_column", "missing_table",
                          "type_mismatch", "timeout", "too_many_rows",
                          "empty_result_unexpected", "shape_mismatch"]
    raw_error_msg: str            # exact DB message (Postgres is great at this)
    likely_fix_hint: str          # generated heuristically, e.g. "column was 'amount_TTC' — Postgres needs double quotes"
    relevant_schema_slice: dict   # 5 nearest tables/columns by edit distance to the failed identifier

Notice relevant_schema_slice: when SQL fails on amount_TTC, you don't dump the whole schema back into the prompt. You ship 5 candidate columns ranked by similarity. This is the
difference between an agent that converges in 2 retries and one that loops forever.

Stop conditions:
- success: query ran, output_shape matches → return
- budget_exhausted: 3 attempts → mark playbook FAILED, escalate to L2
- same_error_twice: deterministic loop detected → kill immediately, don't waste tokens

async def query_loop(spec: QuerySpec, ctx: Ctx) -> Result | Failure:
    attempt = 0
    last_error_hash = None
    while attempt < 3:
        sql = await llm.author_sql(spec, prior_attempts=ctx.attempts)
        if (lint_err := static_lint(sql)):
            ctx.record(attempt, sql, lint_err); attempt += 1; continue
        try:
            rows = await ctx.conn.execute(sql, timeout_s=30, max_rows=50_000)
        except DBError as e:
            err = classify(e, sql, ctx.schema)
            if hash(err) == last_error_hash:
                return Failure("deterministic_loop", err)
            last_error_hash = hash(err)
            ctx.record(attempt, sql, err); attempt += 1; continue
        if not spec.output_shape.matches(rows):
            ctx.record(attempt, sql, ShapeMismatch(rows.preview()))
            attempt += 1; continue
        return Result(sql=sql, rows=rows, attempts=attempt+1)
    return Failure("budget_exhausted", ctx.attempts)

This is ~50 lines of code. It is the most important loop in the whole system. Get this airtight and 80 % of "agentic" failures disappear.

---
L2 — Playbook loop (hypothesis-driven, self-correcting)

Each playbook is one hypothesis. The loop tries up to N distinct SQL formulations of that hypothesis until a finding either materializes with sufficient evidence or is provably
absent.

                  ┌────────────────────────┐
                  │ Playbook template      │
                  │ + semantic layer       │
                  └───────────┬────────────┘
                              ▼
                  ┌────────────────────────┐
              ┌──▶│ Hypothesis Generator   │
              │   │ (LLM, Sonnet)          │
              │   └───────────┬────────────┘
              │               ▼
              │   ┌────────────────────────┐
              │   │ Query Loop (L1)        │
              │   └───────────┬────────────┘
              │               ▼
              │   ┌────────────────────────┐
              │   │ Result Validator       │  ← deterministic
              │   │  • non-empty?          │     code, no LLM
              │   │  • sane magnitudes?    │
              │   │  • passes severity     │
              │   │    rule predicates?    │
              │   └───────────┬────────────┘
              │      pass     │     fail / weak
              │     ┌─────────┴─────────┐
              │     ▼                   ▼
              │  ┌──────────────┐  ┌─────────────────────┐
              │  │ Analyst Agent│  │ Refinement Decider  │
              │  │ (LLM)        │  │ Improve query? OR   │
              │  │ sizes, ROIs, │  │ Test inverse hypo?  │
              │  │ confidence   │  │ OR Drop?            │
              │  └──────┬───────┘  └──────────┬──────────┘
              │         ▼                     │
              │    ┌─────────┐                │
              │    │ Finding │                │
              │    └─────────┘                │
              └──────────────────────────────┘
                  refine / inverse hypothesis

Value function: finding_score ∈ [0, 1], computed deterministically from:
- evidence: row count + signal strength (e.g. concentration > 15% triggers)
- materiality: sized impact / monthly profit baseline
- confidence: 1 if rule-based, 0.7 if LLM-judged
- freshness: data recency

finding_score = evidence * materiality * confidence * freshness

A finding is accepted when score >= threshold AND the Critic later passes it. Below threshold, the Refinement Decider picks one of three moves:

┌─────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Move   │                                                When to take it                                                │
├─────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tighten │ Result is too broad (e.g. 500 customers flagged, noise) → add filters, raise threshold                        │
├─────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Inverse │ No signal where expected (e.g. no concentration risk) → test "is the data even here?" by querying base counts │
├─────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Drop    │ After 2 refinements with no improvement → record as NOT_APPLICABLE_THIS_TENANT, contribute to L4 learning     │
└─────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Critical anti-pattern to avoid: Letting the LLM both generate AND grade the hypothesis. The grader must be a separate call with no access to the generator's reasoning trace.
Otherwise it'll rubber-stamp its own mistakes.

Stop conditions:
- score ≥ threshold and validator passes → emit Finding
- 3 hypothesis refinements without improvement → emit NEGATIVE_FINDING ("checked, not present, here's the evidence")
- Token budget exhausted → emit INCONCLUSIVE with what was tried

Note: emitting a negative finding is success, not failure. "We checked concentration risk; you're at 24%, healthy" is real information. Most agentic systems suppress negatives and
look smarter than they are.

---
L3 — Portfolio loop (the actual memo run)

This is where "loop until real value" gets operational.

              ┌─────────────────────────────────┐
              │  Orchestrator                    │
              │  picks N playbooks by priority:  │
              │   • L4 learned weights           │
              │   • last-run staleness           │
              │   • detected anomaly signals     │
              └──────────────┬──────────────────┘
                             │ fan-out
                ┌────────────┴────────────┐
                ▼            ▼            ▼
            ┌────────┐  ┌────────┐  ┌────────┐
            │ L2 #1  │  │ L2 #2  │  │ L2 #N  │
            └────┬───┘  └────┬───┘  └────┬───┘
                 │           │           │
                 └─────┬─────┴───────────┘
                       ▼
              ┌─────────────────────┐
              │  Portfolio Scorer   │
              │  Σ findings,         │
              │  dedupe overlaps,    │
              │  rank by ROI         │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  Sufficiency Check  │   ← key gate
              │  Do we have enough  │
              │  to ship a memo?    │
              └──────┬────────┬─────┘
                yes  │        │  no
                     ▼        ▼
            ┌──────────┐  ┌────────────────┐
            │ Composer │  │ Top-up:        │
            │ (LLM)    │  │ run K more     │
            └────┬─────┘  │ playbooks at   │
                 ▼        │ lower priority │
            ┌──────────┐  └────────────────┘
            │ Critic   │
            │ (LLM)    │
            │ verifies │
            │ each #   │
            └────┬─────┘
       fail     │   pass
       ┌────────┴────────┐
       ▼                 ▼
  ┌─────────┐      ┌────────────┐
  │ Compose │      │  Deliver   │
  │  again  │      │  (E/S/PDF) │
  └─────────┘      └────────────┘

Value function: memo_value = Σ(finding.materiality × finding.confidence) − cost_penalty(tokens, db_seconds).

The Portfolio Scorer is where you stop people from over-counting:

def score_portfolio(findings: list[Finding]) -> PortfolioScore:
    # 1. Dedupe overlapping findings (e.g. "underpriced" + "concentration top10"
    #    that flag the same customer should not be summed twice)
    deduped = dedupe_by_evidence_overlap(findings, threshold=0.6)
    # 2. Penalize correlated findings
    weighted = [f.materiality * f.confidence * f.uniqueness for f in deduped]
    # 3. Roll up
    return PortfolioScore(
        gross_value = sum(f.materiality for f in deduped),
        weighted_value = sum(weighted),
        n_high_confidence = sum(1 for f in deduped if f.confidence > 0.8),
    )

The Sufficiency Check is the loop's most important gate. If, after running the top 10 playbooks, the memo only has 2 weak findings, the system runs another 5 playbooks instead of
shipping a thin memo. If after that there's still nothing, it ships an honest "quiet week" memo ("we checked 15 things, nothing material"). This is what executives trust. Loops that
always produce 5 findings even on quiet weeks lose credibility fast.

The Critic is the auto-correction backbone of L3. Its only job:

For each numeric claim in the memo:
  Locate the receipt SQL it cites
  Re-execute the SQL (cheap, cached)
  Verify the number in the prose matches the result
  If not → emit Correction(claim, expected, actual)
Compose loop restarts with corrections.

In production this catches ~3–8 % of LLM-fabricated numbers. Zero of those reach the CEO.

Stop conditions:
- Critic passes → ship
- Critic fails 3× with same class of error → escalate to human review queue, don't ship
- Wall-clock budget (default 15 min) exceeded → ship what's verified, mark the rest as "in progress"

---
L4 — Meta loop (learning across runs)

The slow loop that makes the system get better. Three signals feed it:

┌─────────────────────┬────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────┐
│       Signal        │                                 Source                                 │                What it adjusts                 │
├─────────────────────┼────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
│ CEO acceptance      │ Reaction buttons in the memo (👍 / 👎 per finding)                     │ Per-playbook weight for this tenant            │
├─────────────────────┼────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
│ 30-day outcome      │ "Did the recommended action happen? Did it produce projected benefit?" │ Calibration of the sizing engine               │
├─────────────────────┼────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
│ L2/L3 failure rates │ Operational telemetry                                                  │ Deprecate playbooks that fail >50% on a tenant │
└─────────────────────┴────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────┘

Implementation is small and dumb on purpose:

class PlaybookPriors:
    tenant_id: str
    playbook_id: str
    accept_rate: float           # CEO 👍 rate
    realized_capture: float      # mean(actual/predicted) of completed actions
    failure_rate: float          # L2 inconclusive/failed runs
    priority_score: float        # accept_rate * realized_capture * (1 - failure_rate)

Bayesian-update these weights after each run. The Orchestrator in L3 picks playbooks by priority_score. This is the personalization layer — over 6 months, the system specializes to
each company without retraining anything.

---
Auto-correction taxonomy

Every loop has its own correction mechanism. Don't conflate them.

┌───────┬──────────────────────────────┬───────────────────────────────────────────────────────────┬─────────────────────┐
│ Layer │          Error type          │                   Correction mechanism                    │        Owner        │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L1    │ Bad SQL (syntax/column)      │ DB error → ranked schema slice → re-prompt                │ Deterministic       │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L1    │ Empty/weird result shape     │ Output-shape contract → re-prompt with shape feedback     │ Deterministic       │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L1    │ Same error twice             │ Kill loop, escalate                                       │ Deterministic       │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L2    │ Weak signal                  │ Refinement Decider: tighten/inverse/drop                  │ LLM                 │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L2    │ Hypothesis vacuous           │ Inverse query proves data absence → emit negative finding │ LLM                 │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L3    │ Number doesn't match SQL     │ Critic emits Correction → Composer retries                │ LLM + Deterministic │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L3    │ Memo too thin                │ Sufficiency gate → run more playbooks                     │ Deterministic       │
├───────┼──────────────────────────────┼───────────────────────────────────────────────────────────┼─────────────────────┤
│ L4    │ Playbook chronically useless │ Deprecate after N runs of failure_rate > 0.6              │ Deterministic       │
└───────┴──────────────────────────────┴───────────────────────────────────────────────────────────┴─────────────────────┘

Notice most corrections are deterministic. The LLM is given specific feedback and asked to re-emit. Free-form "reflect on your mistake" loops are slow, expensive, and rarely converge
 — avoid them except at L2's Refinement Decider where the move space is genuinely ambiguous.

---
Stopping & budgeting (the part that prevents fortune-killing token bills)

Every agent invocation declares a budget. The runtime enforces it.

@dataclass
class Budget:
    max_llm_tokens_in: int      # input tokens to LLM
    max_llm_tokens_out: int     # output tokens
    max_llm_calls: int          # hard count
    max_db_seconds: float       # cumulative query time
    max_wallclock_s: int        # real seconds
    max_cost_usd: float         # dollars, hard kill

DEFAULT_BUDGETS = {
    "L1.query_loop":     Budget(8_000,  2_000, 4,  30,  60,  0.05),
    "L2.playbook_loop":  Budget(40_000, 6_000, 12, 90,  180, 0.30),
    "L3.portfolio_loop": Budget(400_000, 80_000, 100, 900, 900, 3.00),
}

Every kill is logged with reason ∈ {budget_tokens, budget_calls, budget_time, deterministic_loop, no_progress}. Over 30 days these logs tell you which playbooks are pathologically
expensive on which tenants — you can either fix them or restrict them.

No-progress detection is the underrated piece. After every loop iteration:

def is_making_progress(value_history: list[float], window: int = 3) -> bool:
    if len(value_history) < window: return True
    recent = value_history[-window:]
    return max(recent) - min(recent) > 0.05 * max(abs(v) for v in recent)

If the value function hasn't moved 5% in 3 iterations, the loop stops. This is what stops "looping until value" from becoming "looping forever."

---
The "perfect" enhancements (year 2)

Once the core is stable, layer these in order:

1. Episodic memory per tenant. Vector store of past findings with their CEO reactions and 30-day outcomes. Inject relevant past findings into the L2 hypothesis generator so it
doesn't re-pitch what was rejected last month.
2. Counterfactual probes. Before shipping a finding, the system runs the inverse query and asks: "If I'm wrong, what should I see instead?" — and reports both. This is what separates
 "agent that thinks it's right" from "agent that earns trust."
3. Multi-LLM cross-check on high-stakes findings. For any finding sized > 1% of monthly profit, run it through a second model from a different family (Claude-judged + GPT-judged).
Disagreements get flagged for human review. Cheap insurance.
4. Active learning from human edits. If the CEO edits the memo before forwarding to the board, capture the diff. The Composer fine-tunes its style (via few-shot or LoRA later) on
those diffs. After 6 months your memo writes itself in the CEO's voice.
5. Adversarial critic in dev. A red-team agent whose only job is to find numbers it can falsify. Runs in CI on every playbook change. Forces the playbook authors to write SQL that's
actually defensible.
6. Sandbox replay. Every shipped memo can be re-run against a frozen snapshot to verify reproducibility. This is the only way to debug "you said X last month and it was wrong."

---
The one diagram to remember

Hypothesis ──→ SQL ──→ DB ──→ Result ──→ Validator ──→ Finding ──→ Critic ──→ Memo
     ▲          ▲                            │            │           │
     │          │                            ▼            ▼           ▼
     │          └─── error feedback ◀── shape/sanity ── score ───── # match
     │                                                                │
     └──────────── value-function gradient ─────────────────────────-─┘

Loop limits: budget · no-progress detector · deterministic-loop trap
Truth oracle: the DB. Always.

Internalize that picture and the rest is implementation.

---
What I'd build first

If you give me 3 hours in this repo, I'd implement L1 (the Query Loop) end-to-end against your intigo_finance DB, with the safety harness, error classifier, and schema-slice retry.
That's the thing that makes the whole system work — every other loop calls into it. Once L1 is rock-solid against a real Postgres, L2 takes a day, L3 takes a week, and L4 is a
30-line cron job.

Say the word and I'll start with L1. We'll have it answering "find pricing leakage at Intigo" with a self-corrected query and verifiable result before this conversation ends.
