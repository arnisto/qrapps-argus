# Investigators

An **investigator** is a focused, scoped AI agent that watches for one specific class of operational problem.

Investigators are the heart of Argus. The runtime, the connectors, the dashboard — everything else exists to feed investigators and surface what they find.

## Anatomy of an investigator

```yaml
name: Ghost Delivery Investigator
id: ghost-delivery
description: Detect suspicious delivery confirmations.

triggers:
  events:
    - delivery.completed
  schedule: "*/15 * * * *"   # also run every 15 min

context:
  lookback: 24h
  related_events:
    - gps.ping
    - refund.requested
    - driver.shift.ended

checks:
  - gps mismatch between confirmation point and last GPS ping
  - delivery confirmed outside driver shift hours
  - duplicate delivery completion within 30s
  - refund requested within 1h of confirmation

severity_threshold: medium

provider: claude   # optional override

output:
  alert_channels: [slack:ops]
```

## How a run works

1. **Trigger fires** — either an event matches the subscription, or the cron schedule ticks.
2. **Context loader** pulls related events from the lookback window.
3. **Prompt builder** assembles a structured prompt: investigator description + checks + the events + the output schema.
4. **AI provider** is called via `packages/ai-providers`.
5. **Response is parsed** into a `Finding`:
   ```ts
   {
     investigator_id: "ghost-delivery",
     severity: "medium" | "high" | "critical" | "low" | "none",
     summary: string,
     evidence: Array<{ event_id: string; reason: string }>,
     recommendation: string,
     impact_estimate?: { currency: "EUR"; amount: number; basis: string }
   }
   ```
6. **Persist** the finding to Postgres.
7. **If severity ≥ threshold**, dispatch alerts to configured channels.

## Where definitions live

- **Builtin investigators** — `packages/investigators/templates/*.yaml`. Shipped with the repo, versioned with code.
- **User investigators** — stored in Postgres, editable via the dashboard (v0.3+). YAML-importable.

## Writing a good investigator

Three rules:

### 1. Scope it tight

One investigator = one class of anomaly. Don't write "general fraud detector". Write "duplicate refund within 24h investigator".

Tight scope means:
- shorter prompts → cheaper, faster, more reliable
- clearer evidence → executives trust the alert
- easier to test against history

### 2. Demand structured evidence

The runtime enforces that every finding cites specific `event_id`s. If the AI can't point to events, the finding is rejected. This is non-negotiable — it's what separates Argus from a hallucination machine.

### 3. Write the impact line

A finding without an impact estimate (money, time, count, risk) is half a finding. Investigators must teach the model how to estimate impact for their domain.

## Builtin starter set (v0.1)

Two are enough to demonstrate the runtime:

| Investigator         | Domain          | Severity sources                                    |
| -------------------- | --------------- | --------------------------------------------------- |
| `ghost-delivery`     | logistics       | GPS mismatch, off-hours confirmation, dup completion |
| `refund-anomaly`     | fraud / ops     | refund spike vs baseline, driver concentration, timing |

More land in v0.3.

## Testing investigators

```bash
pnpm investigator:test ghost-delivery --since 7d
```

Replays the last 7 days of events through the investigator, prints findings, does **not** dispatch alerts. Required before merging a new builtin.
