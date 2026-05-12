# Events

Everything in Argus is an event. Connectors emit them; investigators reason over them; findings reference them.

## Schema

```ts
interface Event {
  // Identity
  event_id: string;        // deterministic hash; primary dedup key
  event_type: string;      // dotted lowercase, e.g. "delivery.completed"
  schema_version: 1;       // bumped only on breaking schema change

  // Origin
  source: {
    connector_id: string;  // which connector produced this
    connector_type: 'postgres' | 'mysql' | 'api' | 'webhook' | 'manual';
    table?: string;        // for db connectors
  };

  // Time
  occurred_at: string;     // ISO 8601, when the event happened in source
  ingested_at: string;     // ISO 8601, when Argus saw it

  // Subject (what/who the event is about)
  subject?: {
    type: string;          // 'driver' | 'order' | 'user' | ...
    id: string;
  };

  // Domain payload
  payload: Record<string, unknown>;

  // Optional indexed fields for fast querying
  tags?: Record<string, string>;
}
```

## Example

```json
{
  "event_id": "evt_01HZQ7K8M9N3P4R5S6T7V8W9X0",
  "event_type": "delivery.completed",
  "schema_version": 1,
  "source": {
    "connector_id": "production-orders",
    "connector_type": "postgres",
    "table": "deliveries"
  },
  "occurred_at": "2026-05-10T12:00:00Z",
  "ingested_at": "2026-05-10T12:00:31Z",
  "subject": { "type": "delivery", "id": "DLV-9382" },
  "payload": {
    "delivery_id": "DLV-9382",
    "driver_id": "DRV-001",
    "completed_at": "2026-05-10T12:00:00Z",
    "lat": 48.8566,
    "lng": 2.3522,
    "status": "completed"
  },
  "tags": {
    "driver_id": "DRV-001",
    "zone": "B"
  }
}
```

## Naming convention

`<entity>.<action>`

- `delivery.completed`
- `delivery.failed`
- `refund.requested`
- `refund.approved`
- `driver.shift.started`
- `driver.shift.ended`
- `gps.ping`
- `order.created`
- `order.cancelled`

Entities are singular. Actions are past tense. Lowercase, dot-separated.

## `event_id` determinism

The connector computes `event_id` from a stable tuple — typically:

```
hash(connector_id || event_type || subject.id || cursor_value)
```

This makes ingestion **idempotent**: replaying the same source rows produces the same event IDs, and the database PK conflict is the dedup mechanism.

## Storage

Single Postgres table:

```sql
CREATE TABLE events (
  event_id        TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  schema_version  SMALLINT NOT NULL,
  source          JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject_type    TEXT,
  subject_id      TEXT,
  payload         JSONB NOT NULL,
  tags            JSONB
);

CREATE INDEX events_type_occurred_idx ON events (event_type, occurred_at DESC);
CREATE INDEX events_subject_idx ON events (subject_type, subject_id, occurred_at DESC);
CREATE INDEX events_tags_gin ON events USING GIN (tags);
```

JSONB for flexibility, indexes for the hot query patterns: "events of type X in window", "events for subject Y in window", "events with tag Z".

## Ingestion paths

### From connectors

Connectors call `eventBus.publish(events)`. The bus:
1. Validates with Zod.
2. Inserts with `ON CONFLICT (event_id) DO NOTHING`.
3. For new events, enqueues `events:process` jobs that route to subscribed investigators.

### From `POST /events`

For manual ingestion or external integrations not covered by a connector:

```bash
curl -X POST http://localhost:4000/v1/events \
  -H "Authorization: Bearer $ARGUS_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "refund.requested",
    "occurred_at": "2026-05-10T12:00:00Z",
    "subject": {"type": "order", "id": "ORD-123"},
    "payload": {"amount_cents": 4500, "reason": "damaged"}
  }'
```

The API fills in `event_id` (if not provided), `ingested_at`, and `source.connector_type = 'manual'`.

## Schema versioning

`schema_version` is bumped only when:

- A required field is removed.
- A field's type changes incompatibly.
- The semantics of an existing field change.

Adding optional fields does **not** bump the version. Investigators must tolerate unknown fields.

## What events must never contain

- ❌ Secrets, tokens, password hashes.
- ❌ Full PII when a hashed/redacted version would do (configurable per connector).
- ❌ Free-form blobs > 64 KB. If you have a big blob, store a reference, not the blob.
