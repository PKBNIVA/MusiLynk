# Edge and HTTP caching of public reads

Anonymous visitors read the same public data over and over: the landing counters, the talent and
act directories, open opportunities, the Stage's platform posts, the sitemap. The API now tells
shared caches how long to keep those answers, and the landing page fetches its three public reads
through a same-origin path that Vercel's edge caches. Signed-in responses are never cached.

## What the API sends

`PublicCaching` (`backend/app/controllers/concerns/public_caching.rb`) adds, **only when the
request is an anonymous GET** (no valid bearer token):

```
Cache-Control: max-age=<B>, public, stale-while-revalidate=<M>, s-maxage=<N>
ETag: W/"…"            (a conditional GET with If-None-Match answers 304)
Vary: Authorization
```

`s-maxage` and `stale-while-revalidate` are for shared caches (Vercel's edge). `max-age` is the
browser's own lifetime: `0` on the listing, show and post endpoints so a browser always revalidates
(and gets a 304 when nothing changed) instead of serving a stale body itself.

A signed-in request to the same URL gets Rails' default `max-age=0, private, must-revalidate`
(those bodies carry saved/applied flags, applause, synthetic-QA visibility and admin reach).
`Vary: Authorization` is on every response so no browser, proxy or edge reuses an anonymous body
for a bearer-token request; Vercel's edge additionally never caches a request that carries an
`Authorization` header at all.

### Endpoints and lifetimes

Lifetimes live in **`backend/config/edge_cache.yml`** (seconds); change them there, nowhere else.

| Endpoint | Kind | `s-maxage` (edge) | `stale-while-revalidate` | Browser `max-age` |
| --- | --- | --- | --- | --- |
| `GET /api/public/stats` | `stats` | 300 | 600 | 300 |
| `GET /api/public/talent` (per query string) | `listing` | 60 | 300 | 0 |
| `GET /api/public/acts` (per query string) | `listing` | 60 | 300 | 0 |
| `GET /api/jobs` (per query string) | `listing` | 60 | 300 | 0 |
| `GET /api/public/talent/:id` | `show` | 60 | 300 | 0 |
| `GET /api/public/acts/:id` | `show` | 60 | 300 | 0 |
| `GET /api/jobs/:id` | `show` | 60 | 300 | 0 |
| `GET /api/stage/authors/:type/:id/posts` | `stage_posts` | 60 | 300 | 0 |
| `GET /sitemap.xml` | `sitemap` | 3600 | 86400 | 3600 |

With browser `max-age` 0 the browser keeps the body but asks again with `If-None-Match` and gets a
304 when nothing changed. A change to a profile, act, post or opportunity is therefore visible to
anonymous visitors within about a minute (edge) or at once (direct call, 304 miss).

## How the landing page reaches the edge

The SPA calls the Railway API host directly (`VITE_API_URL`), which Vercel's edge cannot cache.
For the three landing-page reads only, `apiGet(path, { viaEdge: true })` uses `PUBLIC_API_BASE`
(`src/app/lib/api.ts`) instead:

- `GET /public/stats` (counters), `GET /public/talent?location=…&limit=6` (featured people),
  `GET /stage/authors/system/musilynk/posts` (Stage teaser).

`vercel.json` rewrites exactly those three paths (`/api/public/stats`, `/api/public/talent` and
`/api/stage/authors/system/:id/posts`; query strings pass through) to the API host, so with
`PUBLIC_API_BASE` = `/api` those calls are same-origin, Vercel proxies them and caches the answer
per `s-maxage`. No other `/api` path is proxied (`scripts/__tests__/vercel-config.test.mjs` pins
this), and every other call keeps going to `VITE_API_URL`. The CSP's `connect-src 'self'` already
covers same-origin calls.

### Environment variable (names only)

| Variable | Where | Value |
| --- | --- | --- |
| `VITE_PUBLIC_API_BASE` | Vercel, project `musilynk` (public site), Production (and Preview if wanted). Build-time. | `/api` |

Unset, `PUBLIC_API_BASE` equals `VITE_API_URL` and the landing page behaves exactly as before.
Do not set it on `musilynk-admin`: the admin site never makes these reads. Local and CI builds
leave it unset (`VITE_API_URL` is `/api` or the local Rails host there).

## Verifying

- API, anonymous: `curl -sI https://musilynk-api-production.up.railway.app/api/public/stats`
  shows `cache-control: max-age=300, public, stale-while-revalidate=600, s-maxage=300`, an `etag`
  and `vary: … Authorization`.
- API, signed in: the same URL with `-H "Authorization: Bearer <token>"` shows
  `cache-control: max-age=0, private, must-revalidate`.
- Edge (after `VITE_PUBLIC_API_BASE` is set and deployed):
  `curl -sI https://musilynk.vercel.app/api/public/stats` twice; the second answer has
  `x-vercel-cache: HIT` (Vercel strips `s-maxage` from what the browser sees, that is expected).
- Playwright: `tests/e2e/edge-cache.spec.ts` checks the landing page's three reads
  (`QA_BASE_URL=https://musilynk.vercel.app npx playwright test tests/e2e/edge-cache.spec.ts`).
- Rails: `backend/test/integration/edge_caching_test.rb`.

## Purging

Vercel's cache expires by itself within `s-maxage` and serves stale for `stale-while-revalidate`
while it refetches. To drop everything at once: Vercel dashboard → project `musilynk` →
**Settings** → **Caching** → **Purge Cache** (or redeploy; a deployment invalidates the edge
cache). The API's own `Rails.cache` entries (`public-stats:v2`, `sitemap/v2`) expire on their own.
