# Background job queues and the sitemap job

GoodJob (the worker service, `bin/worker`) runs jobs in **separate thread pools per queue group**,
so a burst on one queue never delays another. Before this, every queue shared one 2-thread pool,
and an urgent-hire alert could wait behind hundreds of digest emails.

## Where it is configured

One file: `backend/config/job_queues.yml`.

| Pool | Queues | Threads | What runs there |
| --- | --- | ---: | --- |
| 1 | `urgent` | 2 | `UrgentMatchJob`, `UrgentMatchSweepJob`, `WhatsappAlertJob`, and the urgent-alert email (`NotificationEmailJob` with template `urgent_request_alert`) and push (`PushDeliveryJob` with category `urgent`) |
| 2 | `notifications`, `mailers` | 2 | Other notification and transactional email, web push, job-alert deliveries |
| 3 | `default`, `scheduled` | 1 | Cron sweeps, digests' fan-out, `SitemapRefreshJob`, demo data, upload cleanup |

`urgent.email_templates` and `urgent.push_categories` in the same file list which email templates
and push categories go to the urgent pool.

The database connection pool (`backend/config/database.yml`) is sized from the total thread count
automatically (`RAILS_MAX_THREADS` + job threads + 3), so changing a number needs nothing else.

## How to change it

1. Edit `backend/config/job_queues.yml` (pools, thread counts, or the urgent lists), in a pull request.
2. `bin/rails test test/services/job_queues_test.rb` shows the resulting GoodJob queue string.
3. After deploy, the worker log line `GoodJob ... started scheduler with queues=...` shows the pools.

## Environment variables (names only)

| Variable | Where | Effect |
| --- | --- | --- |
| `GOOD_JOB_QUEUES` | Railway, worker service (optional) | Replaces the pools from the file, in GoodJob's syntax (for example `urgent:2;notifications,mailers:2;default,scheduled:1`). Unset means the file is used. |
| `GOOD_JOB_MAX_THREADS` | Railway, worker service (optional) | Only used for a pool written without a thread count. The default pools all have one, so it no longer changes the worker. |

## The sitemap

`/sitemap.xml` is built by `SitemapRefreshJob` (cron, hourly at :23, `scheduled` queue) into
`Rails.cache` and read by the web request. Building it takes one COUNT per role x city hire page
plus every portfolio (18-35 s at 50k profiles), too long for every crawler request.

- The job writes two keys: the current build (expires after 3 hours) and a last-good copy that
  never expires. When the current build has expired, requests are served the last-good copy and
  one rebuild is queued (at most once per 10 minutes). Crawlers never get an error page.
- Only when nothing was ever stored (a brand-new cache store) does a request build it inline,
  once, under a Postgres advisory lock; other requests wait up to 10 s for that build.
- The pre-deploy step (`railway.toml`: `bin/rails db:prepare && bin/rails sitemap:warm`) builds it
  when nothing is stored, so even a first deploy is not a miss. It is a no-op otherwise and never
  fails the deploy.
- Up to 45,000 URLs it is one `<urlset>`. Past that, `/sitemap.xml` is a `<sitemapindex>` of
  `/sitemaps/1.xml`, `/sitemaps/2.xml`, ... (Vercel rewrites `/sitemaps/:part.xml` to the API), so
  no URL is dropped. Static, hire and rates pages are always in the first file.
- To rebuild by hand: `bin/rails runner 'SitemapRefreshJob.perform_now'` on the worker service.
