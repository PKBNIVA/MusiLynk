# Web performance: the speed gate, photos and loading order

How the public site stays fast on a cheap phone, and the one place each number lives.

## The speed gate (`npm run check:perf`)

`scripts/perf/check-perf.mjs` serves `dist/` on a private port (gzip, like Vercel), answers every
`/api/*` call locally (`scripts/perf/fixtures/*.json`: demo-only data, so the home page renders its
real sections and no live backend is needed), then loads the home and search pages in headless
Chromium on a throttled phone and fails when a page is over budget. It runs in the frontend CI job
after `npm run check:bundle` and takes about 20 s plus the build.

The profile (`scripts/perf/measure.mjs`, Lighthouse's mobile preset): 390×844 at 3x, CPU 4x slower,
1.6 Mbps down / 750 kbps up, 150 ms round trip, cold cache. Numbers reported per page: TTFB, FCP,
LCP and its element, CLS, request count and bytes over the wire.

**Budgets live in one file, `scripts/perf/budget.json`**:

| Limit | Value | Why |
| --- | --- | --- |
| `requests` | 40 | each request costs a round trip (150 ms) on the throttled profile |
| `transferredKB` | 300 | roughly 1.5 s of transfer at 1.6 Mbps |
| `lcpMs` | 3000 | CI gate; LCP on a throttled CPU varies ~300 ms run to run. The production target is Google's "good" 2500 ms, tracked with `perf:measure` after each deploy |
| `cls` | 0.1 | Google's "good" CLS threshold |

Update path: change the value in `budget.json` and append the date, the new measurement and the
reason to its `note`, in the PR whose purpose is that growth. Never raise a budget to get a red
check green; find what grew (`npm run perf:measure -- --base http://127.0.0.1:<port> --mock-api`
prints every request with its bytes).

Measure the live site the same way: `npm run perf:measure -- --base https://musilynk.vercel.app --runs 3`.

## Editorial photos (`public/img`)

Every photo ships as AVIF and WebP at the widths in `src/app/lib/photo.ts` (480, 800, 1200, 1600; the
home hero 480, 768, 1200, 1600). `<Photo>` renders a `<picture>` with the AVIF source first; the home
page's HTML preloads the hero's AVIF candidates (`scripts/prerender-heads.mjs`). To add or replace a
photo: add its credit to `src/app/pages/public/imageCredits.ts`, put the original next to the others
in a folder of your own, then

```
npm i --no-save sharp               # on purpose not a project dependency
npm run perf:photos -- --src <that folder>
npm run perf:photos -- --check      # lists any width or format still missing
```

and commit the generated files. Without `--src`, the smaller sizes are cut from the committed 1600
WebP. Unit tests fail when a variant is missing or an AVIF is not smaller than its WebP.

## Loading order

- The entry chunk renders the shell; the route chunk and the hero image download in parallel
  (the hero is preloaded from the HTML).
- Analytics (`src/app/lib/analytics.ts`) starts two frames after the first paint and records the
  page the router is already on.
- Sentry (`src/app/lib/monitoring.ts`) loads only when `VITE_SENTRY_DSN` is set, and then only after
  the page's `load` event and an idle period (at most 8 s + 3 s). An error reported before then starts
  the download at once; vitals wait.
- Push registration (`src/app/lib/push.ts`) and the service worker run only from the opt-in button.
- Shared UI primitives, Radix internals and Lucide icons are grouped into a few chunks per page
  (`vite.config.ts`, `codeSplitting.groups`) instead of one request each.

## Environment variables (names only; every one optional)

| Variable | Where | What it does |
| --- | --- | --- |
| `VITE_API_URL` | Vercel, both projects | Absolute API origin; also emits `<link rel="preconnect">` to it at build time. |
| `VITE_UPLOADS_ORIGIN` | Vercel, public project | The public base URL profile and act photos are served from (the backend's `AWS_PUBLIC_BASE_URL`). Emits `<link rel="dns-prefetch">` for that host; nothing when unset. |
| `PERF_PORT` | local only | Port for `check:perf`'s dist server (default: a free port). |
