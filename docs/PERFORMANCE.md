# Performance

How MusiLynk keeps pages fast, how to see when they are not, and the latest load-test numbers.

## Guardrails at a glance

| What | Where | What it catches |
| --- | --- | --- |
| Bundle budget | `bundle-budget.json`, `scripts/check-bundle-size.mjs`, CI `frontend` job | A pull request that makes the first page load heavier |
| Core Web Vitals | `src/app/lib/webVitals.ts` → Sentry metrics | Slow loading (LCP), slow taps (INP) and jumping layouts (CLS) for real visitors |
| Tracing sample | `SENTRY_TRACES_SAMPLE_RATE` (API), `VITE_SENTRY_TRACES_SAMPLE_RATE` (web) | Slow requests and page loads, with a span breakdown |
| Request timing | lograge + `RequestLog` (`config/initializers/lograge.rb`) | Every API request logs one JSON line with total, view and database time and the query count, and sends a `Server-Timing` header |
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
| API | `SENTRY_TRACES_SAMPLE_RATE` | `0.1` (10%, requests and jobs) | off |
| Web | `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.05` (5%) | off |

Set either to `0` to turn tracing off, or to another value between `0` and `1`.

## Request timing in the logs

Every API request writes one JSON line (lograge, see `docs/ops/observability.md`) and adds a
`Server-Timing` header:

```
{"event":"http_request","method":"GET","path":"/api/jobs","controller":"JobsController","action":"index","status":200,"duration":352.3,"view":0.4,"db":41.2,"requestId":"…","dbQueries":3}
Server-Timing: db;dur=41.2;desc="3 queries", app;dur=352.3
```

Requests at or over `SLOW_REQUEST_MS` (default 500) carry `"slow":true`. In Railway's log view,
search for `"slow":true` or for an action, e.g. `"controller":"JobsController","action":"index"`.
The header shows up in the browser's dev tools (Network → Timing). SQL statements at or over
`SLOW_QUERY_MS` (default 100) are logged separately as `"event":"slow_query"` with the
statement fingerprinted.

`db` is the time spent in SQL calls. Under load it includes waiting for Ruby's global
lock while other threads work, so compare it with `duration` rather than reading it alone.

## Load test

`scripts/load-test.mjs` (Node 22, no dependencies) runs each scenario for a fixed time with N
concurrent loops and prints requests, throughput, p50/p95/p99, average database time from
`Server-Timing`, and response size. Against a local server it spreads requests over
documentation-range IP addresses so the per-IP search limit does not skew the numbers.

```bash
# 1. A production-mode API on a scratch database with a realistic volume of demo data
cd backend
export RAILS_ENV=production SECRET_KEY_BASE=local-only ALLOWED_ORIGINS=http://localhost \
       DATABASE_URL=postgres://postgres:postgres@localhost:5432/musilynk_perf_load
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
  1. ~~Paginate `GET /api/jobs`~~ (done, see "Job list paging" below). A slimmer listing
     shape (fewer columns per opportunity) would shrink each page further.
  2. Run two Puma worker processes on Railway (`WEB_CONCURRENCY=2` plus a `workers` line
     in `config/puma.rb`, with GoodJob kept in one process) once traffic grows. One Ruby
     process uses one CPU core, so CPU-heavy list requests queue behind each other.

## Job list paging

`GET /api/jobs` returns one page at a time instead of up to 250 opportunities:

- `?limit=` sets the page size: 30 by default, between 1 and 100 (a number outside that
  range is moved to the nearest end; one that is not a whole number means the default).
- The response is `{ jobs, nextCursor, total }`. `nextCursor` is an opaque string for the
  next page (`?cursor=`), `null` on the last page; `total` is how many opportunities match
  the filters. An unreadable cursor is a 400 `INVALID_CURSOR`.
- Paging is by keyset (featured, created date, id), not by offset, so page 10 costs the same
  as page 1 and a job posted while someone is paging does not shift the pages they have not
  loaded yet. Every filter (`q`, `location`, `kind`, `function`, `workplace`, `experience`,
  `paid`, `verified`) applies to every page and to `total`.
- The `jobs` key and each job's shape are unchanged, so an older client still gets a valid
  first page.
- Job search (`/jobseeker/jobs`) and the public list (`/music-jobs`) show "Showing X of Y"
  (announced to screen readers) and a "Load more opportunities" button; focus moves to the
  first new result. The shared logic is `src/app/lib/usePagedJobs.ts`.

Load test before and after, run back to back on the same machine and data (450 published
opportunities from a copy of the demo-data database, one Puma process with 5 threads,
`RAILS_ENV=production`, 10 concurrent clients, 15 s per scenario, load average about 2 to 3).
"next page" requests the second page with the cursor from the first.

| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Avg DB ms | Avg KB (JSON) | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| jobs (all), before: 250 per response | 168 | 10.5 | 928 | 1161 | 1235 | 330.8 | 351.7 | 0 |
| jobs (all), after: first page of 30 | 653 | 43.1 | 225 | 298 | 320 | 72.0 | 42.4 | 0 |
| jobs (next page), after | 603 | 39.6 | 249 | 328 | 355 | 75.2 | 42.3 | 0 |
| jobs (filtered), before | 444 | 28.6 | 320 | 579 | 697 | 106.8 | 104.5 | 0 |
| jobs (filtered), after | 737 | 48.7 | 205 | 280 | 323 | 60.1 | 35.4 | 0 |

The unfiltered list now serves about 4 times as many requests per second with a p95 about
4 times lower, and a first page is 42 kB of JSON (about 5 kB gzipped) instead of 352 kB
(about 33 kB gzipped). It costs one extra query (the `total` count, 4 in all), which
takes a few milliseconds.

## Query plans at volume, 2026-10-03

### How to reproduce

```bash
cd backend
export RAILS_ENV=development DATABASE_URL=postgres://postgres@localhost:5433/ml_perf SECRET_KEY_BASE=x
bin/rails db:create db:schema:load perf:seed   # ~2 min; idempotent; refuses production and non-local databases
bin/rails perf:explain                          # ONLY=feed, PLANS=1 (full plans), REPEAT=5 (runs per query)
```

`perf:seed` (`lib/tasks/perf_seed.rake`) writes, with `insert_all` in batches of 2,000: 50,000 users
with profiles over 16 cities (42,000 musicians, 8,000 hirers), 20,000 acts with 60,000 lineup
members, 20,000 threads with 200,000 messages, 30,000 portfolio items, 5,000 urgent requests,
10,000 opportunities and 10,000 applications, 10,000 bookings, 100,000 notifications, 20,000 Stage
posts and 10,000 availability windows. Two probe accounts (fixed bearer tokens, local data only)
carry 300 threads, 500 notifications and 50 acts each, so the inbox, thread, bookings and
notification queries are measured for a busy user.

`perf:explain` (`lib/tasks/perf_explain.rake`) replays each request, captures every SELECT it runs,
and runs `EXPLAIN (ANALYZE, BUFFERS)` on each five times, keeping the fastest run (the machine was
shared, so noise only ever adds time).

### Before and after

Before = `production` at 011e845 on the same data without this change's indexes; after = this
change. Each side was run twice, interleaved, and the faster run is shown. "Queries" counts the
SELECTs per request; "Slowest" is the slowest one (ms, EXPLAIN ANALYZE execution time); "All" is
the sum of every SELECT in the request; access paths are those of the slowest query after the change.

| Query | Queries before → after | Slowest ms before → after | All ms before → after | Access paths after |
| --- | ---: | ---: | ---: | --- |
| talent list | 11 → 9 | 184.4 → 137.1 | 185.0 → 137.5 | Seq Scan profiles, users; `index_portfolio_items_playable_public` |
| talent ?location=Mumbai | 11 → 9 | 60.8 → 53.1 | 61.4 → 53.5 | Seq Scan profiles (COALESCE match, see below) |
| talent ?role=Vocalist | 11 → 9 | 275.0 → 224.0 | 275.6 → 224.4 | Seq Scan profiles (COALESCE match) |
| talent ?instrument=Tabla | 11 → 9 | 60.1 → 30.0 | 60.6 → 30.4 | `index_profiles_on_instruments_text_trgm` |
| talent ?verified=true | 11 → 9 | 103.6 → 46.5 | 104.4 → 46.9 | Seq Scan users, profiles |
| talent ?remoteRecording=true | 11 → 9 | 95.6 → 47.7 | 96.1 → 48.1 | Seq Scan users, profiles |
| talent ?language=Tamil | 11 → 9 | 107.1 → 64.8 | 107.6 → 65.2 | `index_profiles_on_languages_text_trgm` |
| talent ?eventType=wedding | 11 → 9 | 225.0 → 124.1 | 225.6 → 124.4 | `index_profiles_on_event_types_text_trgm` + `..._open_to_text_trgm` (BitmapOr) |
| talent ?genre=Sufi | 11 → 9 | 83.8 → 44.1 | 84.5 → 44.5 | `index_profiles_on_genres_text_trgm` |
| talent ?budgetMax=20000 | 11 → 9 | 116.6 → 64.7 | 117.1 → 65.1 | Seq Scan users, profiles |
| talent ?q=drummer | 11 → 9 | 222.1 → 177.5 | 222.7 → 178.0 | Seq Scan profiles, users |
| talent ?q=sitar player kochi | 11 → 9 | 60.6 → 55.4 | 61.1 → 55.8 | Seq Scan profiles |
| search all ?q=guitarist | 6 → 6 | 355.3 → 179.5 | 811.0 → 495.6 | Seq Scan acts (per-act lineup subquery) |
| search talent | 2 → 2 | 215.5 → 161.7 | 215.7 → 161.7 | Seq Scan profiles, users |
| search jobs | 1 → 1 | 26.6 → 25.5 | 26.6 → 25.5 | Seq Scan jobs |
| search acts | 1 → 1 | 177.7 → 127.1 | 177.7 → 127.1 | Seq Scan acts |
| search samples | 2 → 2 | 179.1 → 153.4 | 179.2 → 153.5 | Seq Scan portfolio_items, profiles |
| acts list | 4 → 4 | 44.2 → 39.8 | 44.5 → 40.1 | Seq Scan acts, users |
| acts ?city=Pune | 4 → 4 | 16.1 → 13.6 | 16.5 → 13.9 | Seq Scan acts |
| acts ?genre=Jazz | 4 → 4 | 23.1 → 18.6 | 23.3 → 18.9 | `index_acts_on_genres_text_trgm` |
| acts ?q=band | 4 → 4 | 169.7 → 115.6 | 169.9 → 115.8 | Seq Scan acts |
| jobs list (browse) | 4 → 4 | 16.5 → 12.3 | 32.6 → 12.7 | page: `index_jobs_published_browse` (0.8 ms); slowest is the `total` COUNT |
| jobs ?location=Pune | 4 → 4 | 8.9 → 6.4 | 16.3 → 12.8 | Seq Scan jobs |
| jobs ?q=drummer | 3 → 3 | 27.0 → 24.3 | 27.2 → 24.4 | Seq Scan jobs |
| Stage feed | **549 → 11** (18 in the budget test, which adds photo posts and reshares) | 1.2 → 1.3 | 8.7 → 3.1 | primary keys; request 516 ms → 65–87 ms wall |
| Stage tag `#sufi` | **42 → 3** | 5.2 → 1.3 | 6.9 → 3.3 | `index_posts_on_hashtags` (was Seq Scan posts) |
| thread messages | 5 → 5 | 0.0 → 0.0 | 0.1 → 0.1 | `index_messages_on_conversation_id` |
| inbox (musician / hirer) | 7 → 6 | 2.1 → 2.0 | 2.5 → 2.3 | conversations candidate/employer indexes, messages (conversation_id, created_at) |
| unread count | 4 → 4 | 0.8 → 0.8 | 0.8 → 0.9 | conversations indexes, `index_messages_on_conversation_id` |
| public stats (5-min cache) | 10 → 10 | 70.7 → 59.6 | 278.9 → 263.2 | Seq Scan profiles, users |
| profile show | 9 → 9 | 0.0 → 0.0 | 0.1 → 0.1 | primary keys |
| bookings list (act owner) | 8 → 7 | 7.8 → 0.1 | 8.1 → 0.4 | BitmapOr of `requester_id` and `act_id` indexes (was Seq Scan booking_requests + acts) |
| bookings list (hirer) | 8 → 7 | 7.4 → 0.3 | 8.0 → 0.4 | same |
| notifications | 4 → 4 | 0.1 → 0.1 | 0.2 → 0.2 | `index_notifications_on_user_id` |
| urgent candidate scope (Mumbai) | 12 → 12 | 26.8 → 14.6 | 69.8 → 36.5 | `index_profiles_on_location_trgm` (was Seq Scan profiles) |
| sitemap.xml (cache miss) | 389 → 0 | | 18.9–42.6 s → 0.17–0.26 s | built by `SitemapRefreshJob` (18–35 s, 395 queries) off the request |

Most of the drop on the ranked lists that kept their access path (talent, search, acts) is JIT:
those queries cost more than `jit_above_cost`, so Postgres compiled each one with LLVM on every
request (about 45 ms of a 250 ms talent list). `database.yml` now sets `jit: off`.

### What changed

- **Indexes** (`20261003100000_add_hot_query_indexes`, concurrent, reversible): trigram GIN on
  `profiles.languages::text`, `event_types::text`, `open_to::text`, `genres::text`,
  `instruments::text` (the talent facets) and `acts.event_types::text` (the acts facet), all
  matched with a bare `ILIKE` and previously unindexed; trigram GIN on `profiles.location` (the
  urgent candidate scope's `location ILIKE`); `jobs (published_at DESC NULLS LAST, id DESC) WHERE
  status = 'published'` (the browse page); `portfolio_items (user_id) WHERE` public, audio/video and
  with a URL (the talent ranking's "has a playable sample").
- **N+1s**: the Stage feed checked blocks and follows once per candidate post (549 queries); they
  are now read once, and authors, shared jobs (with their applications count) and media are
  batch-loaded for the page. The tag and author lists use the same helpers, and the tag lookup uses
  `hashtags @> ARRAY[...]` (GIN) instead of `= ANY(hashtags)`. Hire pages and the admin Stage and
  refunds lists preloaded nothing for their cards. The talent list counted completed bookings
  and reviews twice (stats and tier); the inbox read blocks in two queries.
- **Plans**: bookings list `requester_id = ? OR act_id = ANY(ARRAY(acts of the user))` instead of a
  join filtered on `acts.owner_id`, so two index scans replace two sequential scans.
- **Writes**: a thread poll with nothing new no longer runs the notification UPDATE.
- **Off the request path**: the sitemap (see `docs/ops/job-queues.md`; served from a never-expiring last-good copy, built inline under a lock only on a brand-new cache), now a sitemap index once
  past 45,000 URLs instead of silently dropping the hire pages.

### Not fixed here (search rework)

`Search::Query` matches `COALESCE(column, '')` or a `concat_ws(...)` of several columns, and no
trigram index can serve either: every `q=`, `location=` and `role=` match is a sequential scan
(the role and location rows above). The 2026-09-27 trigram indexes on headline, bio, name, title
and so on are unused by search. The acts search runs the lineup subquery once per act. Both
belong to the search rework, which owns `Search::Query`, `Search::Runner` and the acts list.

### Guards

- `test/integration/hot_endpoint_query_budget_test.rb` pins the query count of the public talent,
  acts, jobs, profile, act and tag endpoints and of the inbox, thread, notifications, bookings and
  feed endpoints with `assert_queries_at_most(n)` (`test/support/query_budget.rb`), at two sizes.
- `bullet` (development and test only) raises on an N+1 inside any request in the test suite and
  logs it in development (`config/initializers/bullet.rb`).
- The inbox, thread and bookings lists load with `strict_loading`: a new association read raises
  in development and tests and is logged in production.
- Development tags every SQL statement with its controller and action (`query_log_tags`) and logs
  statements over 100 ms (`config/initializers/slow_query_log.rb`).
