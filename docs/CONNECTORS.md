# Connectors

Connectors bring data **in**. They transform rows, API responses, or webhook payloads into Argus events.

## Connector interface

```ts
export interface Connector<TConfig = unknown> {
  id: string;
  type: 'postgres' | 'mysql' | 'api' | 'webhook';

  init(config: TConfig): Promise<void>;
  poll?(): Promise<Event[]>;        // for poll-based sources
  ingest?(payload: unknown): Promise<Event[]>;  // for push sources
  stop(): Promise<void>;
}
```

A connector's only job is: **produce valid `Event` objects**. It must not call investigators, must not write findings, must not dispatch alerts. Separation of concerns is enforced at the package boundary.

## v0.1: PostgreSQL connector

The MVP shipping connector. Configurable per source.

```yaml
# stored in DB; YAML shown for clarity
type: postgres
name: production-orders
connection:
  host: ${PG_HOST}
  port: 5432
  database: orders
  user: argus_reader
  password: ${PG_PASSWORD}
  ssl: true

mappings:
  - table: deliveries
    event_type: delivery.completed
    when: status = 'completed'
    fields:
      delivery_id: id
      driver_id: driver_id
      timestamp: completed_at
      payload: '*'
    cursor:
      column: completed_at
      strategy: gt   # poll for rows where completed_at > last_seen

  - table: refunds
    event_type: refund.requested
    fields:
      refund_id: id
      order_id: order_id
      timestamp: created_at
      payload: '*'

poll_interval: 30s
```

### How polling works

1. On boot, the connector checks the `connector_cursors` table for the last cursor per mapping.
2. Every `poll_interval`, it runs `SELECT ... WHERE cursor_col > last AND ... ORDER BY cursor_col LIMIT 1000`.
3. Each row is mapped to an event with a stable `event_id` (deterministic hash of `connector_id + table + primary_key + cursor_value`).
4. Events are emitted to the bus. Idempotency dedup happens downstream.
5. Cursor is advanced **only after** events are persisted.

### Permissions

The Postgres user must be **read-only** on the source. Argus refuses to start a connector with write privileges. We will not be the cause of someone's prod outage.

## v0.2 connectors

- **MySQL** — same shape as Postgres, different driver.
- **REST API** — configurable URL, auth (bearer / basic / API key / OAuth2 client credentials), JSONPath extraction, polling interval.
- **Webhook** — a stable URL per connector (`/v1/webhooks/:connector_id`), HMAC-signed, payload mapped to an event type.

## Writing a custom connector (post-v0.3, plugin SDK)

Until the plugin SDK lands, custom connectors require a fork. The path is:

1. Create `packages/connectors/src/<your-source>/index.ts` implementing the `Connector` interface.
2. Register it in `packages/connectors/src/registry.ts`.
3. Add config schema (Zod) in `packages/connectors/src/<your-source>/config.ts`.
4. Add a Dockerfile change if a new system dep is needed.

Pull requests for mainstream sources (Stripe, Shopify, MongoDB, BigQuery, etc.) are welcome.

## What connectors must never do

- ❌ Modify the source (read-only).
- ❌ Block on slow upstreams (use timeouts + retries).
- ❌ Lose cursor state on restart.
- ❌ Emit events with unknown event types — register the type first.
- ❌ Embed secrets in the event payload.
