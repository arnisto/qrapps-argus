# Infra

Compose overrides, seed data, and dev fixtures live here.

## Files (ship in v0.2+)

- `docker-compose.prod.yml` — production overrides (build target=runtime, no source mounts).
- `seeds/` — sample event fixtures so a fresh stack has something to investigate.
- `fixtures/` — synthetic data for local demos (drivers, deliveries, refunds).

For v0.1 this folder is intentionally minimal. The default `docker-compose.yml` at the repo root is the supported deployment surface.
