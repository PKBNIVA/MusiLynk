# MusiLynk testers and release gate

MusiLynk has three layers of automated checking plus a live admin tester. The release gate
commands are in [DEPLOYMENT.md → Release gate](../../DEPLOYMENT.md#release-gate).

## 1. Live admin tester (`/admin/tester`)

Sign in as an admin and open `/admin/tester`. It calls `GET /api/admin/tester` and
`GET /api/admin/health` and is read-only (it creates no users, jobs, bookings, charges or
messages), so it is safe to run on production at any time. Checks
(`backend/app/controllers/admin/tester_controller.rb`):

| Check | Severity |
| --- | --- |
| PostgreSQL connection and query latency | critical |
| Core tables present (users, profiles, jobs, applications, portfolio_items, acts, booking_requests, subscriptions, recent_activities, crew_plans, audit_logs) | high |
| Production `FRONTEND_URL` is https | high |
| Upload storage configured (R2/S3 or persistent disk) | high |
| Release traceability (`RAILWAY_GIT_COMMIT_SHA` present) | high |
| Email delivery provider configured | medium |
| Razorpay key, secret and webhook secret present | medium |
| No duplicate user emails; no non-positive booking payments | high |
| Payment idempotency indexes present | high |
| Expired session backlog under 1,000 | low |

The same page has an **Error alerting** panel that sends a tagged test error to Sentry
(see [DEPLOYMENT.md → Error alerting and uptime](../../DEPLOYMENT.md#error-alerting-and-uptime)).

## 2. Rails tests (`cd backend && bin/rails test`)

Integration tests in `backend/test/integration/` cover every API route for every role
(`api_matrix_test.rb`; a new route without a matrix spec fails the inventory test), the
keys the React pages read (`api_frontend_contract_test.rb`), error shapes, security probes,
query budgets, billing and the Razorpay simulator end to end, uploads, sign-in codes,
messaging, account export and deletion, and rate limits. Job and model tests sit beside them.

## 3. Browser tests (Playwright, `tests/e2e/`)

- `npm run qa:e2e` runs the specs against a local Vite preview with a mocked API
  (projects `chromium-desktop` and `chromium-mobile`; Firefox and WebKit are optional).
- `integration-journeys.spec.ts` runs against a real Rails API and PostgreSQL in the
  `integrated-journeys` CI job.
- `payments-simulator.spec.ts` needs a local API with `RAZORPAY_SIMULATOR=true`.
- `api-health.spec.ts` (project `api`) checks the live API; the scheduled
  **MusiLynk QA Agent** workflow (`.github/workflows/qa-agent.yml`) runs the live checks nightly
  and on demand.

`npm run test:all` runs the Node smoke tests in `tests/frontend-*.mjs`: the API client, monitoring
and web-vitals modules, the bundle-budget script, a scan for native browser dialogs, and the built
bundle in `dist/` (Sentry, toasts and the confirm dialog must stay out of the first paint), so run
`npm run build` first. Page behaviour (failed requests, retries, empty states, optimistic updates)
is tested by rendering the real pages in Vitest, under `src/app/**/__tests__/`.

### Running Playwright on a shared machine

- **Serial rule.** Ports and the `dist/` build folder are shared, so run one Playwright command
  at a time per machine: wrap every run in the lock, for example
  `flock /tmp/musilynk-playwright.lock npx playwright test tests/e2e/hire-pages.spec.ts --project=chromium-desktop`.
  Run only the specs that reference what you changed; CI runs the whole suite.
- **Ports.** The local servers use four consecutive ports from `QA_PORT_BASE` (default `4173`, which
  is what CI uses): `base` the app, `base+1` the app built with a fake Sentry DSN, `base+2` the fake
  Sentry ingest endpoint, `base+3` the admin site. Locally Playwright reuses a server that already
  answers on those ports, so two runs on the same base silently share (and can break) each other's
  servers. Give every extra worktree or agent its own base, for example
  `QA_PORT_BASE=4273 flock /tmp/musilynk-playwright.lock npx playwright test ...`. Preview servers use
  `--strictPort`, so a port held by something else fails loudly instead of moving.
  `admin-signin.spec.ts` and `admin-console.spec.ts` still assume the default base in a few
  assertions; run the admin project on the default ports until they read the base too.
- **Screenshots.** The on-demand `zz-*-shots.spec.ts` specs write to `SHOTS_DIR` (default
  `.qa-stack/shots/` in the repo, which is git-ignored). They only run when `LANDING_SHOTS=1` or
  `SHOWCASE_SHOTS=1` is set.
- **Populated pages.** `openSettledPage` answers the directory endpoints with three professionals,
  three opportunities and three acts (`populatedFixtures` in `tests/e2e/qa-helpers.ts`), so the
  axe sweep and the overflow and cursor checks see real cards. The fixtures are typed with the
  same interfaces the pages use (`src/app/lib/apiTypes.ts`); keep them that way when fields change.
- **Axe over a seeded local stack (launch-2 acceptance).** With the API and web app running against a
  seeded database (for example the `demo:showcase` batch), point the same sweep at it:
  `QA_BASE_URL=http://127.0.0.1:4600 flock /tmp/musilynk-playwright.lock npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/public-experience.spec.ts --project=chromium-desktop --project=chromium-mobile`.
  A run with `QA_BASE_URL` starts no servers and uses no mocks, so it sees the real cards.
- **Nightly live run.** `.github/workflows/qa-agent.yml` (`live-synthetic`) opens a GitHub issue
  labelled `qa-failure` when it fails and posts a summary comment on it. It runs the signed-in
  smoke only when the repository secrets `QA_SMOKE_EMAIL` and `QA_SMOKE_PASSWORD` exist (a
  dedicated musician account; owner action 8 in `docs/MUSILYNK_PLAN.md`).

## 4. CI

`.github/workflows/rails-and-web.yml` runs the `frontend` (npm audit, typecheck, lint,
format, build, bundle budget, public/admin split, `test:all`, unit tests), `rails` (tests
plus a schema drift check and `zeitwerk:check`), `security` (Brakeman, bundler-audit) and
`integrated-journeys` jobs on every pull request. `.github/workflows/qa-agent.yml` runs the mocked browser suite
on pull requests and the live synthetic checks on a schedule.

## What automation cannot prove

Before a high-traffic launch, also do: real-device testing on Safari/iOS and Android,
screen-reader passes, load testing against production-sized data, a real Razorpay live
deposit and refund, inbox delivery of real transactional email, a backup restore drill
([RUNBOOK.md](../engineering/RUNBOOK.md#4-restore-from-backup)), a legal/privacy review and
a security penetration test.
