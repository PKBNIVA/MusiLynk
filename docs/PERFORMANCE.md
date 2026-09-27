# Performance

How Verse keeps pages fast, how to see when they are not, and the latest load-test numbers.

## Guardrails at a glance

| What | Where | What it catches |
| --- | --- | --- |
| Bundle budget | `bundle-budget.json`, `scripts/check-bundle-size.mjs`, CI `frontend` job | A pull request that makes the first page load heavier |
| Core Web Vitals | `src/app/lib/webVitals.ts` → Sentry metrics | Slow loading (LCP), slow taps (INP) and jumping layouts (CLS) for real visitors |
| Tracing sample | `SENTRY_TRACES_SAMPLE_RATE` (API), `VITE_SENTRY_TRACES_SAMPLE_RATE` (web) | Slow requests and page loads, with a span breakdown |
| Request timing | `ApplicationController#log_request` | Every API response logs total time, database time and query count, and sends a `Server-Timing` header |
| Query budget | `backend/test/integration/api_query_budget_test.rb` | N+1 queries and unbounded lists in every GET list endpoint |
| Load test | `scripts/load-test.mjs` | Throughput and p50/p95 of the busiest public and signed-in endpoints |

## Frontend bundle

Every route is lazy-loaded (`src/app/routes.tsx`). The first page load downloads the entry
chunk, a shared `react-vendor` chunk (React, React DOM and the router, which change rarely, so
browsers keep them cached across deploys), the API client and the monitoring shim.

`npm run build && npm run check:bundle` measures the build (gzip level 9) against
`bundle-budget.json` and fails when a number is over:

- `entryChunk`: the `<script type="module">` in `dist/index.html`
- `initialJs`: the entry plus every `modulepreload`, i.e. all JavaScript before any page chunk
- `largestChunk`: the biggest JavaScript file in `dist/assets`
- `css`: the stylesheets linked from `dist/index.html`

If a change really needs more, raise the number in the same pull request and say why.

Changes made on 2026-09-27 (gzip):

| | Before | After |
| --- | ---: | ---: |
| JavaScript on first load (entry + preloads) | 124.0 kB | 100.2 kB |
| Entry chunk | 24.8 kB | 7.3 kB |
| Sign-in page chunk | 42.8 kB | 4.2 kB |
| Largest chunk | 43.4 kB (`react-dom`) | 75.0 kB (`react-vendor`: React, React DOM, router together) |

- The sign-in page used the `motion` animation library for one fade-in; that was replaced
  by a CSS animation (the global `prefers-reduced-motion` rule still shortens it).
- The toast container (`sonner`) and the plan-limit dialog (Radix alert dialog and its focus
  and scroll-lock helpers) now load after the first render instead of in the entry chunk.
  Toasts raised before the container mounts are kept and shown when it does.
- Unused packages in `package.json` are not a bundle cost: Vite only bundles what is imported.

## Real-user monitoring (Core Web Vitals)

When `VITE_SENTRY_DSN` is set, `src/app/lib/webVitals.ts` measures, with the browser's own
`PerformanceObserver` and no extra library:

- **LCP** (largest contentful paint): until the first tap or key press; skipped for tabs
  opened in the background.
- **INP** (interaction to next paint): the slowest interaction, ignoring one outlier per 50.
- **CLS** (cumulative layout shift): the largest 5-second session window.

Each value is sent once per page view, when the page is hidden, as a Sentry distribution
metric (`web_vital.lcp`, `web_vital.inp` in milliseconds, `web_vital.cls`) tagged with the
route template (for example `/professionals/:id`, never a name or id) and its rating
(`good`, `needs-improvement`, `poor`, using the published thresholds). Without a DSN nothing
is measured or sent. See them in Sentry under Explore → Metrics; a useful alert is
"p75 of `web_vital.lcp` above 2500 ms for an hour".

## Tracing

Once a DSN is set, a small share of requests is traced by default:

| | Variable | Default with a DSN | Without a DSN |
| --- | --- | --- | --- |
| API | `SENTRY_TRACES_SAMPLE_RATE` | `0.02` (2%) | off |
| Web | `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.05` (5%) | off |

Set either to `0` to turn tracing off, or to another value between `0` and `1`.

## Request timing in the logs

Every API request writes one JSON line and adds a `Server-Timing` header:

```
{"event":"http_request","method":"GET","path":"/api/jobs","route":"jobs#index","status":200,"durationMs":352.3,"dbMs":41.2,"dbQueries":3,...}
Server-Timing: db;dur=41.2;desc="3 queries", app;dur=352.3
```

Requests at or over `SLOW_REQUEST_MS` (default 500) are logged at warn level with
`"slow":true`. In Railway's log view, search for `"slow":true` or for a route, e.g.
`"route":"jobs#index"`. The header shows up in the browser's dev tools (Network → Timing).

`dbMs` is the time spent in SQL calls. Under load it includes waiting for Ruby's global
lock while other threads work, so compare it with `durationMs` rather than reading it alone.

## Load test

`scripts/load-test.mjs` (Node 22, no dependencies) runs each scenario for a fixed time with N
concurrent loops and prints requests, throughput, p50/p95/p99, average database time from
`Server-Timing`, and response size. Against a local server it spreads requests over
documentation-range IP addresses so the per-IP search limit does not skew the numbers.

```bash
# 1. A production-mode API on a scratch database with a realistic volume of demo data
cd backend
export RAILS_ENV=production SECRET_KEY_BASE=local-only ALLOWED_ORIGINS=http://localhost \
       DATABASE_URL=postgres://postgres:postgres@localhost:5432/verse_perf_load
bin/rails db:prepare
RAILS_ENV=development bin/rails synthetic_qa:seed BATCH=demo-load JOBSEEKERS=1000 EMPLOYERS=300 \
  SYNTHETIC_QA_PASSWORD='LoadTestPass123!'
bin/rails server -b 127.0.0.1 -p 3186 &

# 2. The load test (the inbox scenarios sign in as one of the seeded employers)
cd ..
LOAD_EMAIL=qa+demo-load-employer-0001@example.invalid LOAD_PASSWORD='LoadTestPass123!' \
  node scripts/load-test.mjs --base http://127.0.0.1:3186/api --duration 15 --concurrency 10 --markdown
```

Never run it against production without agreeing a time first; it is designed for a local
or staging copy.

### Results, 2026-09-27

Data: 1,300 users (1,000 professionals, 300 employers), 600 opportunities, 1,000
applications, 1,000 conversations, 600 bookings, from the demo-data seeder. Server: one Puma
process with 5 threads (the Railway setup), `RAILS_ENV=production`, local PostgreSQL 16, on a
4-core container that other jobs were loading heavily at the same time (load average 13 to
19), so the absolute numbers are pessimistic; compare runs on the same machine. 10
concurrent clients, 15 s per scenario. KB is the uncompressed JSON size.

| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Avg DB ms | Avg KB (JSON) | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| search | 336 | 22.0 | 426 | 682 | 774 | 188.8 | 25.2 | 0 |
| jobs (all) | 91 | 5.7 | 1564 | 3171 | 3413 | 378.0 | 357.4 | 0 |
| jobs (filtered) | 385 | 24.2 | 358 | 766 | 1155 | 85.8 | 90.1 | 0 |
| public talent list | 133 | 8.1 | 1211 | 1736 | 1941 | 242.6 | 127.6 | 0 |
| public profile | 899 | 59.5 | 140 | 396 | 494 | 35.2 | 2.5 | 0 |
| public acts | 219 | 14.3 | 655 | 1060 | 1164 | 148.1 | 101.4 | 0 |
| inbox | 1001 | 66.5 | 134 | 292 | 380 | 40.9 | 2.3 | 0 |
| inbox thread | 1164 | 77.5 | 106 | 295 | 470 | 28.7 | 0.8 | 0 |

### Findings

- **No N+1 queries** in these paths: every scenario runs a fixed number of queries (3 for
  the job list, 8 for search, 3 to 4 for the others), and the query-budget test guards all
  list endpoints. The SQL itself is fast: the full job listing query takes about 4 ms
  (`EXPLAIN ANALYZE`), and each search group 1 to 10 ms.
- **Big list payloads were the cost.** `GET /api/jobs` returns up to 250 opportunities with
  every column, about 357 kB of JSON; the public talent and acts lists are 100 to 130 kB.
  Time goes into building and sending that JSON, not into the database. Fixed here: JSON
  responses are now gzip-compressed (`config/initializers/response_compression.rb`), so the
  job list goes over the network as about 33 kB, talent as 9 kB and acts as 13 kB.
- **Search writes to the database on every request**: the per-IP rate-limit counter lives in
  Solid Cache (PostgreSQL), which costs one small transaction per search. That is by design
  (limits must be shared and survive restarts) and costs a few milliseconds.
- **Follow-ups worth doing** (not done here, they change behaviour):
  1. Paginate `GET /api/jobs` (for example 30 per page with a cursor) and send a slimmer
     listing shape; the list page does not need every column of every opportunity.
  2. Run two Puma worker processes on Railway (`WEB_CONCURRENCY=2` plus a `workers` line
     in `config/puma.rb`, with GoodJob kept in one process) once traffic grows. One Ruby
     process uses one CPU core, so CPU-heavy list requests queue behind each other.
