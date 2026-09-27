# Architecture

## System

```text
Browser ── React 18 + Vite SPA (src/) ─────────── Vercel (static, vercel.json: SPA routing, CSP, headers)
   │
   │  HTTPS JSON, Authorization: Bearer <token>        VITE_API_URL=…railway.app/api
   ▼
Rails 8.1 API (backend/) ─────────────────────── Railway service from backend/Dockerfile
   ├─ controllers/   one per resource under /api; admin/ and billing/ namespaces
   ├─ models/        ActiveRecord, state rules and validations
   ├─ services/      Razorpay, email, uploads, entitlements, readiness, account export/erasure
   └─ jobs/          GoodJob: email, notifications, job alerts, billing reconciliation, upload sweep
   │
   ▼
PostgreSQL (Railway) ── app data, GoodJob queue, Solid Cache (rate-limit counters)

External: Razorpay (subscriptions, deposits, webhooks) · Brevo (transactional email)
          Cloudflare R2 / S3 (uploads, direct from the browser) · Sentry (errors, when DSNs are set)
```

- **Frontend.** `src/app/routes.tsx` defines every page; `src/app/lib/api.ts` is the only
  HTTP client (timeouts, bounded retries, error shapes); `authContext.tsx` holds the session.
  Locally, Vite proxies `/api` to `http://127.0.0.1:3000`.
- **API.** Routes are in `backend/config/routes.rb`, all under `/api`. The contract, roles and
  error shape are documented in [docs/API.md](docs/API.md) and enforced by
  `backend/test/integration/api_matrix_test.rb` (every route × every role).
- **Background work.** GoodJob runs inside the web process by default
  (`GOOD_JOB_EXECUTION_MODE=async`) and can move to a separate worker; cron schedules are in
  `backend/config/initializers/good_job.rb`. Job failures are reported to Sentry without
  arguments.
- **Health.** `/api/live` and `/api/health` (process up, deployed commit),
  `/api/readiness` (database and required configuration; 503 when not ready),
  `/api/admin/health` (per-check detail, admin only).

## Security boundary

- The server is authoritative for identity, roles, ownership and state transitions; the
  browser never grants access or paid entitlements.
- Passwords use bcrypt (`has_secure_password`). Email one-time codes are the primary sign-in;
  password sign-in is a fallback controlled by `PASSWORD_LOGIN_ENABLED`.
- Sessions are random bearer tokens stored as SHA-256 digests, valid 30 days, capped at 10
  per user; the browser keeps the token in `localStorage`. Logout, suspension and the admin
  "revoke sessions" action end them.
- Rate limits (login, sign-up, codes, messaging, search) use the Rails cache, which is Solid
  Cache on PostgreSQL in production, so limits are shared across processes and survive
  restarts.
- CORS allows only `ALLOWED_ORIGINS`; request bodies are capped at 1 MB; `vercel.json` sets a
  strict CSP and security headers.
- Sensitive actions are written to `audit_logs`. Logs and error reports filter passwords,
  tokens, codes, emails and signatures.

More in [SECURITY.md](SECURITY.md).

## Domain

Four related but separate workflows share identity, trust and messaging:

1. **Career hiring**: jobs, gigs, auditions, sessions, tours, internships and collaborations,
   with applications and an employer pipeline.
2. **Band building**: band projects with missing seats published into the moderated hiring
   funnel; crew plans that convert into band projects.
3. **Act booking**: acts (solo to ensemble) receive dated enquiries, send quotes, accept
   bookings and collect deposits through Razorpay orders.
4. **SaaS operations**: subscriptions, trials, plan entitlements (`Entitlements`), workspace
   seats and admin billing tools.

Subscription revenue and booking deposits are separate ledgers. Signed Razorpay webhooks own
subscription state, and `BillingReconciliationJob` repairs anything a crash left behind (see
[docs/engineering/SAAS_BILLING.md](docs/engineering/SAAS_BILLING.md)). Payouts to performers
are not built.

Data areas: identity (users, profiles, sessions, sign-in codes, email tokens), opportunities
(jobs, saved jobs, alerts), hiring (applications, events, shortlists, talent folders), proof
(portfolio items, uploads), communication (conversations, messages, notifications, blocks),
trust (verification requests, reports, reviews, audit logs), booking (acts, requests, quotes,
payments, availability, urgent requests), organizations, and billing (subscriptions, billing
attempts, billing events).

## Known limits

- Search is PostgreSQL `ILIKE` with synonym expansion
  ([docs/engineering/SEARCH.md](docs/engineering/SEARCH.md)).
- One region, one database; backups are nightly (RPO 24 h), see
  [docs/engineering/RUNBOOK.md](docs/engineering/RUNBOOK.md).
- A single `admin` role; no admin MFA or narrower support roles yet.
