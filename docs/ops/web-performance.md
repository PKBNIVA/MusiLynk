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

## Pre-rendered first screens

`npm run build` = `vite build` (the browser bundle) + `npm run build:ssr` (`src/entry-server.tsx` as a Node
module in `dist-ssr/`, not deployed) + `scripts/prerender-heads.mjs`, which renders each route in
`PRERENDERED_PATHS` (home, music-jobs, music-professionals, book-music, urgent, pricing, guide, join/*)
and every hire and rates page to HTML inside `<div id="root" data-prerendered="<route>">`, and one
shell per record family (`professionals/shell.html`, `acts/shell.html`, `opportunities/shell.html`,
served by `vercel.json` rewrites for every id). `main.tsx` hydrates when the marker matches the URL,
otherwise it renders from scratch (a host serving the wrong file can never show a mismatch).

Rules for a page that is pre-rendered: its first render must not read the browser (no `window`,
storage, the clock or the URL's query string in render), and it must render the same thing for a
signed-out visitor before `/me` answers (the auth status is `loading` in both places). Anything the HTML
cannot know is read behind `useHydrated()` (`src/app/lib/hydrated.ts`; false for the hydration render,
true right after) or in an effect: `useUrlFilters` exposes `ready`, `/pricing` applies `?code=`, `?interval=`
and the saved promo code after mount, `/urgent` fills in "tomorrow, 6 pm" and the `?role=&city=` prefill
after mount. `src/__tests__/entry-server.test.tsx` checks the HTML carries no date and is the same with or
without a query string.

The per-page `<title>` and description come from one table, `PUBLIC_PAGE_META` in
`src/app/lib/siteMeta.ts` (also `publicOrigin()`, `documentTitle()`, `clipDescription()`), read by the
pages, by `prerender-heads.mjs` and by the OG image function; `src/__tests__/pageMetaParity.test.tsx` diffs
the baked head against the DOM after hydration for every pre-rendered path. A lazily
loaded part inside such a page (`React.lazy` + `Suspense`) renders behind `useMounted()`
(`src/app/lib/clientOnly.ts`), so the HTML has no half-hydrated boundary for a state update to hit. Data
still loads in the browser, so a page shows its frame and skeleton; the hire and rates pages take
their heading from the slugs (`seoPages.ts`). `tests/e2e/prerender.spec.ts` fails on any hydration
error on any pre-rendered route; `src/__tests__/entry-server.test.tsx` renders a few in Node.

To pre-render another route: add its path to `PRERENDERED_PATHS` (and to `ROUTES` if it has no head
yet), run `npm run build`, open it with `npm run check:perf`'s server or `vite preview`, and add it to
the Playwright list. Pages that depend on who is looking (search, sign-in, the workspace) stay
client-rendered on purpose.

## Client data cache (`src/app/lib/dataCache.ts`)

A stale-while-revalidate cache in front of `apiGet`, one entry per GET path, owned by the signed-in identity
(a sign-in, sign-out or "act as" change clears it). Concurrent reads of one path share one request. Lists
(`usePagedList`) remember every page they showed, so Back shows them at once with no request while the
first page is fresh; record pages (profile, act, opportunity) read the cache first; the inbox, thread and
unread badge poll through it and re-render only when the data changed. Cards prefetch their page on
hover/focus (desktop) or first touch (mobile), lists prefetch the next page within a screen of the bottom;
both rate-limited.

**TTLs and invalidation rules live in one file, `src/app/lib/dataCache.config.ts`**: `CACHE_TTL_MS` per
family (`list` 60 s, `record` 120 s, `inbox`/`thread`/`unread` 0 = always revalidate but show memory
first, `notifications`/`bookings` 15 s), `CACHE_MAX_AGE_MS`, the prefetch limits, and
`INVALIDATE_ON_WRITE` (which cached paths a POST/PUT/PATCH/DELETE to a resource makes stale) and
`INVALIDATE_ON_EVENT` (which cached paths a live update of a given type makes stale). Update path: change
the number or the list there, in the PR that needs it, and say why in the PR.

Realtime (Action Cable, `src/app/lib/realtime.ts`): every socket event reaches the cache first
(`realtime.event`), which stales the paths `INVALIDATE_ON_EVENT` names for its type; a screen showing one
of them refetches it at once. A new event type needs a line there. Pages can also call
`realtime.invalidate(path)` or `realtime.update(path, fn)`; the `dataCache.ts` header documents the calls.

Optimistic writes: sending a message shows the bubble at once ("Sending…") and reconciles with the server
copy; a failure removes it, restores the draft and toasts. Booking status changes update the row at once
and roll back with a toast on failure.

## Loading order

- The HTML already holds the first screen of a pre-rendered page; the entry chunk hydrates it while the
  route chunk and the hero image download in parallel (the hero is preloaded from the HTML).
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
