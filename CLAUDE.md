# qrapps-argus (v1, rebuilt 2026-11-03)

A small AI SaaS: sign in, create a company, connect Facebook, confirm the objective the AI proposes, collect,
filter into signals, weekly report checked against its evidence. First client: Lovixa. Design: `docs/V1.md`.
Everything before v1 was deleted; it is in git history before commit of 2026-11-03.

## Layout

- `apps/argus` — the only app. Next.js 16 (`src/proxy.ts`, not middleware), React 19, Tailwind 4, zod 4.
  - `src/lib/ai/` — `gemini.ts` (structured JSON, `thinkingBudget=0`), `propose-objective.ts`, `filter-signals.ts`, `report.ts` (writer + deterministic `critic`)
  - `src/lib/meta/graph.ts` — Graph API client, OAuth, posts, Ad Library. Official API only, never scraping.
  - `src/lib/jobs/run-objective.ts` — collect, filter, report for one objective (service role)
  - `src/app/api/jobs/run` — cron entry (Bearer `CRON_SECRET`); `src/app/api/meta/{start,callback}` — OAuth
- `supabase/migrations/` — SQL, additive, one file per change; `supabase/tests/` — pgTAP RLS tests

## Commands (from the repo root)

| Goal | Command |
|---|---|
| Install | `pnpm install` |
| Dev | `pnpm dev` (port 3050, main session only) |
| Typecheck, lint, test | `pnpm typecheck`, `pnpm lint`, `pnpm test` |
| RLS test | `supabase test db` |

## Rules

- Every table has `company_id` and RLS through `is_member()`. App code uses the session client; the service role
  (`utils/supabase/admin.ts`) is only for the job runner and only after the caller is checked.
- Tokens at rest: AES-256-GCM with `APP_SECRET` (required, no disk fallback). Tokens go in the `Authorization`
  header, never in a URL.
- Every AI call goes through `generateJson` with a zod schema; tests use `fakeGeminiFetch`, never a live call.
- A report number must equal a number in a cited signal (`critic`). Never weaken that check to make a report pass.
- Never read or print `.env*` values. Names live in `apps/argus/.env.example`.
- Commit to `main`, no PRs (solo). Commit email is the repo-local one (070@).
