<!-- Thanks for contributing to Argus 🛰️ -->

## What this changes

<!-- One paragraph: what does this PR do? Lead with the *why*, not the *what*. -->

## How to verify

<!-- Steps a reviewer should run to convince themselves it works.
     Code paths that should be exercised, CLI commands, etc. -->

```bash
# example
pnpm -F @argus/api typecheck
pnpm -F @argus/dashboard typecheck
```

## Screenshots

<!-- For any UI change. Drop them in here. -->

## Checklist

- [ ] Typecheck passes (`pnpm -F @argus/api typecheck` and `… dashboard typecheck`)
- [ ] If schema changed: a new migration file under `docker/postgres/migrations/`
- [ ] If a connector or channel was added: catalog entry in `apps/api/src/connectors/catalog.ts` + adapter under `apps/api/src/connectors/adapters/`
- [ ] If a route was added: a Zod schema at the boundary
- [ ] Comments explain *why*, not *what*
- [ ] No plaintext secrets committed (`.env`, API keys, OAuth client secrets)

## Out of scope

<!-- Things you considered but explicitly didn't do, so the reviewer doesn't ask. -->

## Related issue

<!-- If applicable: closes #N -->
