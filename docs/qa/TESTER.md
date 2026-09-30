# Verse testers and release gate

Verse has three layers of automated checking plus a live admin tester. The release gate
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
  **Verse QA Agent** workflow (`.github/workflows/qa-agent.yml`) runs the live checks nightly
  and on demand.

`npm run test:all` runs the frontend source smoke tests in `tests/frontend-*.mjs`.

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
