# Observability: logs, request ids, slow queries, tracing

What the API writes, where to read it, and how to go from a person's report ("it failed at
14:03") to the exact request, its SQL and its Sentry event.

## Environment variables (names only; all optional)

| Variable | Where | Default | What it does |
| --- | --- | --- | --- |
| `RAILS_LOG_LEVEL` | Railway, `musilynk-api` and `musilynk-worker` | `info` | Log level. `warn` keeps only slow queries, slow-request lines are still `info`. |
| `SLOW_REQUEST_MS` | Railway, `musilynk-api` | `500` | A request at or over this many ms gets `"slow":true` in its log line. |
| `SLOW_QUERY_MS` | Railway, `musilynk-api` and `musilynk-worker` | `100` | SQL at or over this many ms is logged as `"event":"slow_query"`, fingerprinted. |
| `SENTRY_DSN` | Railway, both services | unset | Error tracking and performance tracing. Unset = nothing is sent anywhere. |
| `SENTRY_TRACES_SAMPLE_RATE` | Railway, both services | `0.1` | Share of requests and job runs traced once a DSN is set (0 to 1). Profiling is always off. |
| `LOGRAGE` | development only | on | `LOGRAGE=false` restores Rails' multi-line request log on a developer's machine. Production ignores it. |

Configuration lives in one place each: the request line in `backend/config/initializers/lograge.rb`
(+ `app/services/request_log.rb`), slow queries in `backend/config/initializers/slow_query_log.rb`
(+ `app/services/slow_query_log.rb`, `sql_fingerprint.rb`), tracing in
`backend/config/initializers/sentry.rb`, the request id in `backend/lib/edge_request_id.rb`.

## The request line

One JSON line per API request, written when the response is done:

```
[9f1a2b3c-…] {"event":"http_request","method":"GET","path":"/api/jobs","controller":"JobsController","action":"index","status":200,"allocations":41231,"duration":352.3,"view":0.4,"db":41.2,"requestId":"9f1a2b3c-…","userHash":"3b9e2c1d4a5f6e70","dbQueries":3}
```

| Field | Meaning |
| --- | --- |
| `method`, `path` | The HTTP method and the path **without its query string**. No parameters are ever logged. |
| `controller`, `action` | The Rails controller and action that answered. |
| `status` | HTTP status. For an unhandled exception it is `500` and `error` names the exception **class only**; messages can quote record values and are left out. |
| `duration`, `view`, `db` | Milliseconds: whole request, rendering, SQL. `dbQueries` is the number of statements. |
| `requestId` | The request id, same as the `X-Request-Id` response header, the `[…]` tag in front of every other log line of that request, and the `request_id` tag on any Sentry event it raised. |
| `userHash` | Present when someone was signed in: a keyed HMAC of their user id (first 16 hex characters). The same person always gets the same hash, so their requests can be followed, but the id, email or name never appear. Compute it for a known id with `RequestLog.user_hash(id)` in a Rails console. |
| `slow` | `true` when `duration >= SLOW_REQUEST_MS`. Absent otherwise. |

Not logged, by construction: query strings, request bodies, headers, cookies, IPs, user ids,
emails, names. `GET /api/live` (Railway's health probe) is silenced entirely.

### Slow queries

```
[9f1a2b3c-…] {"event":"slow_query","durationMs":184.2,"name":"User Load","sql":"SELECT \"users\".* FROM \"users\" WHERE \"users\".\"email\" = ? AND id IN (?) LIMIT ?","source":"controller:talent,action:public_index"}
```

The statement is a **fingerprint**: every string, number and list of literals is replaced by
`?`, bind placeholders (`$1`) and identifiers are kept, comments are dropped. The same slow
query therefore always logs the same `sql`, which is what you group by. `name` is Active
Record's label (`User Load`, `Job Count`), `source` the query-log tag when it is present.

## Reading logs on Railway

1. Railway → project → service `musilynk-api` (or `musilynk-worker` for jobs) → **Logs**.
   Both services write JSON lines to stdout; Railway adds the timestamp.
2. **Filter box.** Railway's log filter is a plain text match, so paste a fragment of the JSON:
   - everything slow: `"slow":true`
   - slow SQL: `"event":"slow_query"`
   - one endpoint: `"controller":"JobsController","action":"index"`
   - errors: `"status":500` (or `"status":5` for all 5xx)
   - a person's requests: `"userHash":"3b9e2c1d4a5f6e70"` (from `RequestLog.user_hash(id)`)
3. **Time window.** Use the date picker above the log stream, then narrow with a filter; the
   stream is newest-last.
4. **CLI.** `railway logs --service musilynk-api --json | grep '"slow":true'` works the same way
   (install the Railway CLI and `railway link` the project first).

## Finding a request by id

Every request has one id, visible in four places:

1. **In the browser**: the API sends it back as the `X-Request-Id` response header; the SPA puts
   it on `ApiError.requestId` and in Sentry (web) events, and the "Report a problem" dialog
   includes it in the report.
2. **In Railway logs**: filter by the id. Every line the request wrote starts with `[<id>]`
   (Rails' log tag), and its `http_request` line has `"requestId":"<id>"`. A slow query that
   belongs to it carries the same tag.
3. **In Sentry (API)**: the event's `request_id` tag; search `request_id:<id>`.
4. **In Vercel**: calls that went through Vercel's rewrites (`/sitemap.xml`, the share pages,
   `/api/public/stats`, `/api/public/talent`, the Stage system posts) carry Vercel's own id in
   `x-vercel-id` (for example `bom1::sfo1::k7h2x-1759500000000-9f1a2b3c4d5e`). The API adopts
   it as its request id with `::` and `/` turned into `-` (`bom1-sfo1-k7h2x-…`), so the same
   value appears in Vercel's request log and in Railway's.

A client may also send its own `X-Request-Id`; the API keeps it (letters, digits, `-`, `_`,
`@`, at most 255 characters) and makes one up only when nothing arrived.

## Tracing (Sentry performance)

With `SENTRY_DSN` set, `SENTRY_TRACES_SAMPLE_RATE` (default 0.1) of requests and ActiveJob runs
are traced: Sentry → Performance shows each transaction (`JobsController#index`,
`EmailDeliveryJob`) with its SQL spans, so a slow endpoint can be broken down. Profiling is off
and cannot be turned on by a variable (it would need the stackprof gem). Every event still goes
through `ErrorScrubber` (`before_send` and `before_send_transaction`): no bodies, cookies, query
parameters, IPs or queue arguments reach Sentry, and emails or tokens inside messages are masked.

## Admin "Health" tab

The admin site's **Health** tab reads `GET /api/admin/health` (the same readiness checks the
deploy uses): release, database, storage, email, payments and the optional integrations, with
the reason when one is not ready. It is a read-only view of existing data; nothing is changed
from there.

## Tests

- `backend/test/integration/request_log_test.rb`: the line's shape, no parameters, no ids or
  emails, the user hash, slow flag, exception class only, request-id propagation (client,
  Vercel), Sentry tag.
- `backend/test/services/slow_query_log_test.rb`: fingerprinting (strings, numbers, lists,
  quoting, comments, length) and the subscriber (no literal values in the log).
- `backend/test/services/error_reporter_test.rb`: the 10% default sample, profiling off,
  scrubbing.
