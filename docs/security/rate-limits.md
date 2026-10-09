# Rate limits and abuse controls

Every limit the API applies lives in **`backend/config/rate_limits.yml`** and is read through
`RateLimits` (`backend/app/services/rate_limits.rb`) by the `UserRateLimit` concern
(`backend/app/controllers/concerns/user_rate_limit.rb`), which `ApplicationController` includes.
No limit is written into a controller: a call site names its bucket (`throttle!("register")`) and
the window, limit, fail mode and Turnstile flag come from the config. The table below is generated
from that file (the `limit`/`scopes`, `period_seconds`, `fail` and `turnstile` keys); the `path`
and `key` columns are the config's own annotations.

## Changing a limit

1. Edit the bucket in `backend/config/rate_limits.yml` (`limit` or `scopes`, `period_seconds`,
   `fail`, `turnstile`). Add a new bucket there before using its name in a controller:
   `RateLimits::UnknownBucket` is raised on the first request for a name that is not in the file,
   so a typo fails in test instead of running unlimited in production.
2. Run `bin/rails test test/integration/rate_limits_test.rb`: it checks the file's shape, that every
   bucket a controller names exists, which buckets fail closed, and that each public endpoint 429s
   at exactly its limit.
3. Regenerate the table below (see the end of this page) and commit both.

Counters are fixed windows in `Rails.cache` (Solid Cache in PostgreSQL in production, Redis when
`REDIS_URL` is set), so they are shared by every process and survive restarts.

## How a limit answers

- Over the limit: `429` with `{error, code?}` and a `Retry-After` header (seconds left in the window).
  Per-user buckets use `code: "RATE_LIMITED"`.
- **Cache store unavailable** (store down: Redis or Solid Cache's failsafe answers nil, or raises):
  buckets marked `fail: closed` answer `503 RATE_LIMIT_UNAVAILABLE` with `Retry-After: 60` and do
  nothing else (no code issued, no email sent), and the outage is reported to Sentry once per bucket.
  Every other bucket **fails open** so a cache outage never takes the site down. Closed today: OTP
  request and verify (email and WhatsApp), forgot-password, and the reset-password token endpoints.
  The admin second factor stays open on purpose: a cache outage must never lock admins out.
  A `NullStore` (the test suite's default) counts nothing and is a configuration, not an outage.
- **Turnstile** buckets (`register`, `otp-request`) additionally require a Cloudflare Turnstile
  token when `TURNSTILE_SECRET_KEY` is set: see `docs/ops/turnstile.md`.

## 429 spike alert

Every 429 bumps `rate429:<bucket>:<window>` in the cache. `RateLimitSpikeAlertJob` runs every
5 minutes (`config/initializers/good_job.rb`) and, for each bucket whose count in the **last
completed** window is at or above its threshold (`spike_alert.threshold`, overridable per bucket
under `spike_alert.thresholds`), sends one Sentry message (`level: warning`, tag
`source: rate_limit_spike`, fingerprinted per bucket so a sustained attack is one issue). It also
writes a `rate_limit_spike` log line. The request log (`RequestLog`) still carries every 429's
status and route pattern for ad-hoc counting on Railway.

## What a stranger can call, and what guards it

Anyone on the internet, with no bearer token, can reach the buckets in the first block of the table
(sign-up, sign-in and its failure budgets, OTP request/verify by email and WhatsApp, password reset,
resend-verification, search and suggest, analytics events, link previews and link-import drafts,
act-invite links by token, verified share cards, and signed-out problem reports). Signed-out
problem reports also have a honeypot field and a site-wide daily cap.

Deliberately **not** rate limited per IP, and why:

| Endpoint | Guard today | Why no per-IP limit |
| --- | --- | --- |
| `GET /api/public/talent`, `/api/public/acts`, `/api/jobs`, `/api/public/stats`, `/api/public/hire-pages/*`, `/api/public/rates/:city`, `/api/stage/feed`, `/api/stage/authors/system/:id/posts` | Edge cache (`PublicCaching`, `Cache-Control` + Vercel), 60 s search cache, offset paging with capped `limit` | `/api/public/stats`, `/api/public/talent` and the system posts are **proxied through Vercel rewrites** (`vercel.json`), so the API sees Vercel's egress IPs, not the visitor's: a per-IP limit there would throttle every visitor at once. The others are read-only, cheap and cached. Proposal: a per-IP limit keyed on `X-Forwarded-For`'s first hop once the rewrite set is reviewed. |
| `GET /api/auth/methods`, `GET /api/health`, `/api/live`, `/api/readiness`, `GET /api/taxonomy`, `GET /api/legal/policy` | Constant-time reads, cached | Nothing to abuse; health checks must never 429. |
| `GET /share/*` crawler pages, `sitemap.xml` | Edge cache 24 h, crawler user-agents only via rewrite | Served to crawlers; a per-IP limit would hide pages from Google/WhatsApp previews. |
| Contact / enquiry | There is no public contact endpoint: `/contact` is a static page and enquiries (`POST /api/bookings`, `POST /api/conversations`) require sign-in and are per-user limited (`conversation`, `urgent-request-create`). | – |
| `POST /api/email/webhook/brevo`, `POST /api/billing/webhook/razorpay` | Signature verification | Provider webhooks; a 429 would make the provider retry and back off. |

## The table

Generated from `backend/config/rate_limits.yml`. Limit is per key per window; `scopes` list the
failure budgets by scope. Fail mode: what happens when the cache store cannot count.

| Bucket | Route(s) | Keyed by | Limit / window | Fail mode, extras |
| --- | --- | --- | --- | --- |
| `register` | POST /api/auth/register | ip | 60 / 1 hour | open, Turnstile |
| `login-failure` | POST /api/auth/login | email+ip, email, ip (failures only) | email_ip: 10, email: 100, ip: 50 / 15 minutes | open |
| `otp-request` | POST /api/auth/otp/request | email, ip | email: 5, ip: 30 / 1 hour | closed, Turnstile |
| `otp-verify-failure` | POST /api/auth/otp/verify | ip (failures only; per-code attempts capped by SignInCode::MAX_ATTEMPTS) | ip: 25 / 15 minutes | closed |
| `phone-otp-request` | POST /api/auth/phone-otp/request | phone, ip | phone: 5, ip: 30 / 1 hour | closed |
| `phone-otp-verify-failure` | POST /api/auth/phone-otp/verify | ip (failures only) | ip: 25 / 15 minutes | closed |
| `password-reset` | POST /api/auth/forgot-password | ip | 10 / 1 hour | closed |
| `reset-password-token` | GET /api/auth/reset-password/check, POST /api/auth/reset-password | ip | 30 / 15 minutes | closed |
| `resend-verification` | POST /api/auth/resend-verification | ip | 10 / 1 hour | open |
| `resend-verification-email` | POST /api/auth/resend-verification (silent per-address cap, same answer either way) | email | 3 / 1 hour | open |
| `second-factor-failure` | POST /api/auth/second-factor | ip, user (failures only) | ip: 25, user: 10 / 15 minutes | open |
| `second-factor-challenge` | POST /api/auth/login (admin password step, codes emailed) | email | email: 5 / 1 hour | open |
| `search` | GET /api/search | ip | 60 / 1 minute | open |
| `search-suggest` | GET /api/search/suggest | ip | 120 / 1 minute | open |
| `events` | POST /api/events | ip | 120 / 1 minute | open |
| `link-preview` | POST /api/link-previews | ip | 60 / 10 minutes | open |
| `link-import-draft` | POST /api/link-import/draft | ip | 60 / 10 minutes | open |
| `act-invite-token` | GET /api/act-invites/preview, POST /api/act-invites/accept|decline (by token) | ip | 40 / 10 minutes | open |
| `share-card` | GET /share-cards/verified/:user_id(.svg|/landscape.svg) | ip | 60 / 1 minute | open |
| `problem-report-ip` | POST /api/problem-reports (signed out) | ip | 3 / 1 hour | open |
| `problem-report-ip-day` | POST /api/problem-reports (signed out) | ip | 8 / 1 day | open |
| `problem-report-email` | POST /api/problem-reports (signed out) | email | 3 / 1 day | open |
| `problem-report-site` | POST /api/problem-reports (signed out, whole site) | site | 100 / 1 day | open |
| `problem-report-ip-signed-in` | POST /api/problem-reports (signed in) | ip | 40 / 1 hour | open |
| `problem-report` | POST /api/problem-reports (signed in) | user | 10 / 1 hour | open |
| `email-verification` | POST /api/auth/request-email-verification | ip | 5 / 1 hour | open |
| `onboarding-starter` | POST /api/onboarding/starter | ip | 30 / 1 hour | open |
| `library-import` | POST /api/library/import | ip | 30 / 1 hour | open |
| `promo-validate` | POST /api/billing/codes/validate | ip | 30 / 1 minute | open |
| `report` | POST /api/reports | user | 30 / 1 hour | open |
| `urgent-request-create` | POST /api/urgent-requests | user | 10 / 1 hour | open |
| `conversation` | POST /api/conversations | user | 20 / 1 hour | open |
| `message` | POST /api/conversations/:id/messages | user | 120 / 1 hour | open |
| `account-export` | GET /api/account/export | user | 5 / 1 hour | open |
| `account-email-change` | POST /api/account/email/request | user | 5 / 1 hour | open |
| `account-delete` | DELETE /api/account | user | 10 / 1 hour | open |
| `account-email-confirm-failure` | POST /api/account/email/confirm | user (failures only) | user: 10 / 15 minutes | open |
| `account-password-failure` | POST /api/account/password | user (failures only) | user: 10 / 15 minutes | open |
| `admin-email-change` | POST /api/admin/account/email/request | user | 5 / 1 hour | open |
| `admin-email-confirm-failure` | POST /api/admin/account/email/confirm | user (failures only) | user: 10 / 15 minutes | open |
| `admin-password-failure` | POST /api/admin/account/password | user (failures only) | user: 10 / 15 minutes | open |
| `act-invite-search` | GET /api/acts/:id/invitees | user | 60 / 1 hour | open |
| `act-invite-resend` | POST /api/acts/:id/invites/:invite_id/resend | user | 20 / 1 hour | open |
| `ai-suggest-hour` | POST /api/ai/suggest | user | 30 / 1 hour | open |
| `ai-suggest-day` | POST /api/ai/suggest | user | 150 / 1 day | open |
| `career-entry-create` | POST /api/career-entries | user | 120 / 1 hour | open |
| `org-member-invite` | POST /api/organizations/:id/members | user | 30 / 1 hour | open |
| `portfolio-create` | POST /api/portfolios | user | 30 / 1 hour | open |
| `portfolio-draft` | POST /api/portfolios/draft | user | 60 / 1 hour | open |
| `push-subscribe` | POST /api/push/subscriptions | user | 30 / 1 hour | open |
| `push-unsubscribe` | DELETE /api/push/subscriptions | user | 30 / 1 hour | open |
| `resume-create` | POST /api/resumes | user | 30 / 1 hour | open |
| `upload` | POST /api/uploads/presign, PUT /api/uploads/local | user | 120 / 1 hour | open |
| `block` | POST|DELETE /api/blocks/:id | user | 60 / 1 hour | open |
| `billing-profile` | PUT /api/billing/profile | user | 30 / 1 hour | open |
| `stage.applause` | POST /api/stage/posts/:id/applause | user | 300 / 1 hour | open |
| `stage.comments` | POST /api/stage/posts/:id/comments | user | 60 / 1 hour | open |
| `stage.posts` | POST /api/stage/posts | user | 20 / 1 hour | open |

Regenerate with (from `backend/`):

```
bin/rails runner 'RateLimits.limits.each { |n, r| l = r[:limit] ? r[:limit].to_s : r[:scopes].map { |k, v| "#{k}: #{v}" }.join(", "); puts "| `#{n}` | #{r[:path]} | #{r[:key]} | #{l} / #{ActiveSupport::Duration.build(r[:period_seconds].to_i).inspect} | #{[r[:fail].to_s == "closed" ? "closed" : "open", (r[:turnstile] ? "Turnstile" : nil)].compact.join(", ")} |" }'
```

Related: `docs/ops/turnstile.md` (the human check), `docs/security/AUDIT-2026-10.md` (the audit that
asked for this page), `docs/ops/observability.md` (reading 429s in the request log).
