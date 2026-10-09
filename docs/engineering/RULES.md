# MusiLynk engineering rules

The rules every change to this repository follows, whether a person or an agent makes it.
Short version: [CONTRIBUTING.md](../../CONTRIBUTING.md). System map:
[ARCHITECTURE.md](ARCHITECTURE.md). Incidents: [../ops/RUNBOOKS.md](../ops/RUNBOOKS.md).

## The product and the stack

MusiLynk (repo `PKBNIVA/MusiLynk`, release branch `production`) is an Indian marketplace that
links musicians with the people who hire them.

- **Frontend**: React 18, Vite 8, Tailwind 4, React Router 7, TypeScript strict, Vitest,
  Playwright. The public site and the admin site are two builds of the same code
  (`VITE_APP_TARGET=admin`). Hosted on Vercel; `vercel.json` carries the CSP, rewrites and
  cache headers.
- **Backend**: Rails 8.1 API in `backend/`, Ruby 3.4.5, PostgreSQL, GoodJob worker, Solid Cache
  (Redis if `REDIS_URL` is set), Active Storage on Cloudflare R2 through the S3 API. Hosted on
  Railway as two services (`musilynk-api`, `musilynk-worker`) plus Postgres.
- **Providers**: Razorpay (payments), Brevo (email), WhatsApp Cloud API (urgent alerts), Sentry
  (errors). Each is off until its variables are set.
- **Live**: https://musilynk.vercel.app, https://musilynk-admin.vercel.app,
  https://musilynk-api-production.up.railway.app (`/api/health` returns the deployed commit;
  `/api/live` is the liveness check).

Shapes worth knowing before you change anything:

- Pages are lazy-loaded from `src/app/routes.tsx`. `src/main.tsx` boots monitoring, then renders.
- `scripts/prerender-heads.mjs` writes a per-route `<head>` after `vite build`.
- `bundle-budget.json` + `scripts/check-bundle-size.mjs` enforce gzip budgets. The entry chunk is
  nearly full: new boot code must be lazy.
- `src/app/lib/usePolling.ts` is the visibility-aware poller (chat 3 s, inbox and badge 10 s).
- Search runs on indexed `search_vector` / `search_text` columns (`Search::Runner`); the
  vocabulary is `backend/config/search_synonyms.yml`.
- Pagination is offset-based (`limit`, `cursor`).
- Brand assets come from `brand/logo/` via `npm run brand:build`.
- Legal and business facts live in `backend/config/legal.yml`.

## The twelve rules

1. **Scope.** Do only the task you were given. Anything else you notice goes in a "Proposals"
   note in your PR or report, not in the diff.
2. **Config, not code.** Anything that changes (brand, legal, fees, prices, flags, lists,
   limits) lives in one config file with one documented update path under `docs/ops`. No new
   hard-coded business values. The list of config files is below.
3. **Tests are not optional.** Every endpoint: auth, authorisation, validation, happy path, and
   a query-count assertion (`assert_queries_at_most`, `backend/test/support/query_budget.rb`).
   Every UI change: a unit test plus Playwright on desktop and mobile. Never skip, weaken,
   quarantine or delete a test to get green. If an assertion encoded the old behaviour, change
   it and say why in the commit.
4. **Budgets are law.** Bundle size, page speed, query counts, accessibility. Raise a budget only
   in a PR whose purpose is that growth, with the reason written into the budget file. Prefer
   lazy-loading to raising.
5. **No new runtime dependency** without a one-paragraph justification in the PR body: size,
   maintenance, the alternative considered. Dev dependencies need a one-line reason.
6. **Security.** No secrets in code, logs, commits, PR text or client env. Rate-limit anything a
   stranger can trigger. No PII in logs. Every new env var is optional and the feature is cleanly
   off when unset. Document it in `docs/ops` by name and provider field, never by value.
7. **Data.** Preserve all production data. Migrations are reversible; a destructive one needs a
   backup step first and a written rollback. Never `git reset --hard`, never force-push, never
   push to someone else's branch.
8. **Gates before push.** All of the gates below green locally before you push.
9. **PR and CI.** Open the PR against `production`. Title 70 characters or fewer. Body: what,
   why, how verified, env vars by name, budget changes. Red CI is yours to root-cause and fix;
   "flake" is not a root cause. The reviewer merges, not the author.
10. **Report format.** When you hand work over, report in this order, briefly: what changed
    (user-visible, then technical); files; env vars (names only); gates with exact counts;
    measurements before and after where they apply; risks; proposals; PR URL.
11. **Two strikes.** If the same step fails twice, stop and write down what failed and why.
    Do not try a third approach on your own.
12. **Blocked means blocked.** If a tool, account or action is denied, say so. Never work around
    a denial.

## The gates

Run from the repository root. CI (`.github/workflows/rails-and-web.yml` and
`.github/workflows/qa-agent.yml`) runs the same things; the five required checks on
`production` are `frontend`, `rails`, `security`, `integrated-journeys` and `local-experience`.

| Gate | Command | What it checks |
| --- | --- | --- |
| Lint | `npm run lint` | ESLint, zero warnings |
| Format | `npm run format:check` | Prettier on `src/`, `tests/` and root scripts |
| Types | `npm run typecheck` | `tsc --noEmit`, strict |
| Unit | `npx vitest run` | Vitest (about 960 tests) |
| Bundle | `npm run build && npm run check:bundle` | gzip budgets in `bundle-budget.json` |
| Speed | `npm run check:perf` | request count, bytes, LCP and CLS budgets in `scripts/perf/budget.json` |
| Site split | `npm run check:split` | admin code never ships in the public build |
| Playwright | `npx playwright test <specs> --project=chromium-desktop --project=chromium-mobile` | the specs you touched plus those covering your area; admin specs use `--project=admin-desktop` |
| Rails | `cd backend && bin/rails test <files> test/integration/api_matrix_test.rb` | the tests you touched plus the route-by-role matrix |
| Brakeman | `cd backend && bundle exec brakeman -q` | when the backend changed |

Backend changes also need a fresh test database loaded from the schema (`bin/rails db:create
db:schema:load`), never from seeds. Commit the regenerated `db/schema.rb` with every migration.

## The budgets

| Budget | File | Current limits |
| --- | --- | --- |
| Bundle (gzip) | `bundle-budget.json` | entry chunk 30 kB, initial JS 105.7 kB, largest chunk 80 kB, CSS 30 kB |
| Page speed (throttled phone, `/` and `/search`) | `scripts/perf/budget.json` | 40 requests, 300 kB transferred, LCP 3000 ms in CI (2500 ms target in production), CLS 0.1 |
| Queries per endpoint | `backend/test/**` via `assert_queries_at_most` | measured per endpoint; listed in `docs/PERFORMANCE.md` |
| Accessibility | `tests/e2e/accessibility.spec.ts` | axe: zero WCAG A/AA violations on the covered pages |

Each budget file carries a dated note explaining every raise. Keep that habit.

## Config, not code: the files

One file per concern, one documented way to change it. Checked on 2026-10-03 against
`origin/production` and the open PRs.

| File | What it holds | Update path | Where it is |
| --- | --- | --- | --- |
| `brand/logo/` | mark, wordmark, colours; `npm run brand:build` regenerates every asset | `brand/logo/README.md` | `production` |
| `backend/config/legal.yml` | legal name, GSTIN, address, invoice prefix, grievance officer | `docs/ops/billing-invoices.md`, `backend/docs/compliance-checklist.md` | `production` |
| `backend/config/edge_cache.yml` | CDN lifetimes for anonymous public reads | `docs/ops/edge-caching.md` | `production` |
| `backend/config/job_queues.yml` | GoodJob thread pools and which deliveries ride the urgent pool | `docs/ops/job-queues.md` | `production` |
| `backend/config/search.yml` | search tuning (count cap, limits) | `docs/ops/search.md` | `production` |
| `backend/config/search_synonyms.yml` | search vocabulary: roles, instruments, genres, events, spellings | `docs/ops/search.md` | `production` |
| `backend/config/retention.yml` | how long each kind of record is kept | `docs/ops/retention.md` | PR #182 (open) |
| `backend/config/backups.yml` | in-app backup prefix, retention days, verify table count | `docs/ops/backups.md` | PR #181 (open) |
| `scripts/perf/budget.json` | page speed budget | `docs/ops/web-performance.md` | `production` |
| `bundle-budget.json` | bundle size budget | `docs/PERFORMANCE.md` | `production` |

Also on `production` and governed by the same rule: `backend/config/urgent.yml` (urgent-hire
promise, quiet hours, matcher fan-out), `backend/config/billing.yml` (early-access programme),
`backend/config/bookings.yml` (booking fee and cancellation policy), `backend/config/ai_pricing.yml`,
`backend/config/verification.yml`, `backend/config/seo_pages.yml` (hire-page roles and cities),
`backend/config/search_taxonomy.yml`, `backend/config/link_import.yml`.

If you find a business value hard-coded, move it into one of these files (or a new one with a
`docs/ops` page) instead of editing it in place.

## Review

A reviewer reads the PR against the task and this file and posts a pass or a fix list. Address
every item (fix it, or reply why not), push, and report again in the same format. The PR is
merged on green after the review passes. Railway deploys the backend only after the five
required checks pass on the merge commit; Vercel deploys the frontend on merge.
