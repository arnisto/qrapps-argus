# Argus

A small AI SaaS that watches a company's market on Facebook and reports what matters, with evidence.
First client: Lovixa.

**The loop:** sign in, create a company, connect Facebook, confirm the objective Argus proposes, and Argus
collects posts and ads every day, keeps only real signals, and writes a weekly report where every number links
to the item it came from. A deterministic checker rejects any report with a number that is not in its evidence.

Facebook data comes only from Meta's official API: your own pages, the public Ad Library, and (after Meta App
Review grants Page Public Content Access) public competitor pages. Argus never scrapes and never posts.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, Tailwind 4, Supabase (Auth + Postgres with RLS), Gemini for the
three AI steps, Vercel Cron for the daily run. One app: `apps/argus`. Schema: `supabase/migrations/`.

## Run it locally

```bash
pnpm install
cp apps/argus/.env.example apps/argus/.env.local   # fill the values
# apply supabase/migrations/20261103000001_init.sql to your Supabase project (SQL editor or `supabase db push`)
pnpm dev                                            # http://localhost:3050
```

Trigger a collection run by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3050/api/jobs/run
```

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test
supabase test db   # RLS negative test in supabase/tests/, needs the local Supabase stack
```

Design and phases: [`docs/V1.md`](docs/V1.md). The pre-v1 products (observability platform, knowledge layer,
Python autopilot) were deleted on 2026-11-03 and live in git history before that date.

## License

AGPL-3.0. See [LICENSE](./LICENSE). Code before 2026-07-11 was Apache-2.0 ([LICENSE-APACHE-2.0](./LICENSE-APACHE-2.0)).
