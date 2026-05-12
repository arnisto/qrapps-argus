# Repo-level scripts

Cross-workspace helpers. Most one-shot tasks live inside their workspace's
`scripts/` directory (e.g. `apps/api/scripts/migrate.ts`); this folder is for
things that span the whole monorepo.

Reserved for v0.2:
- `release.ts` — version bump + changelog cut + tag.
- `bench.ts` — connector + investigator throughput benchmark.
