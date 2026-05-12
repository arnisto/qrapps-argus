# Builtin investigator templates

YAML files in this directory are loaded into the `investigators` table on first
boot (and re-loaded with `pnpm db:seed`) with `source = 'builtin'`.

User-authored investigators live in the database, not here.

See [docs/INVESTIGATORS.md](../../../docs/INVESTIGATORS.md) for the schema and
authoring guide.

## Shipping in v0.1

| File                  | Domain         | Triggers                                |
| --------------------- | -------------- | --------------------------------------- |
| `ghost-delivery.yaml` | logistics      | `delivery.completed` + 15-min schedule  |
| `refund-anomaly.yaml` | fraud / ops    | `refund.requested` + hourly schedule    |
