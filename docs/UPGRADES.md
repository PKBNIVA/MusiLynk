# Dependency upgrades

What moved, what is on hold and why, and the routine that keeps it that way. Rules for any
upgrade PR: [engineering/RULES.md](engineering/RULES.md) (rule 5 for new dependencies, rule 4
for budgets, rule 8 for the gates).

## Where we stand (2026-10-03)

| Layer | Version | Notes |
| --- | --- | --- |
| Node | 22 (`engines >=22.18`, CI `node-version: 22`) | 24 in PR #178 (open) |
| Ruby | 3.3.6 (`backend/.ruby-version`, `backend/Dockerfile`) | 3.4.5 in PR #178 (open) |
| Rails | 8.1.4 (`load_defaults 8.1`) | upgraded 2026-09-27, [RAILS8_UPGRADE.md](RAILS8_UPGRADE.md) |
| React / React DOM | 18.3.1 | 19 on hold, see below |
| React Router | 7.18.4 | 8 on hold, see below |
| Vite | 8.3.2 | |
| Vitest | 5.0.3 | |
| TypeScript | 5.9.3 | 7 on hold, see below |
| ESLint / typescript-eslint | 9.39.5 / 8.71.0 | ESLint 10 on hold with TypeScript 7 |
| Tailwind | 4.3.3 | |
| Playwright | 1.63.0 | |
| lucide-react | 1.51.0 | major, this week |
| motion | 14.0.0 | major, this week |
| @sentry/react / sentry-ruby | 11.4.0 / 7.1.0 | |
| good_job | 4.19.4 | |
| pg gem | 1.7.0 | |
| Postgres (Railway) | 18 | client tools in the image follow it (`PG_CLIENT_MAJOR`, PR #181) |

## Upgraded this week (2026-09-29 to 2026-10-03)

Read from the merged PRs. Each one passed every gate and left the budgets as noted.

| PR | What moved | Budget effect |
| --- | --- | --- |
| #169 (Dependabot, merged 03 Oct) | `@sentry/react` 11.0.0 → 11.1.0, `typescript-eslint` 8.70 → 8.71 (the `npm-minor-and-patch` group) | none |
| #171 (merged 03 Oct) | Backend gems: `aws-partitions` 1.1290 → 1.1292, `aws-sdk-s3` 1.232.2 → 1.232.3, `sentry-ruby`/`sentry-rails` 7.0.0 → 7.1.0, `jwt` 2.10.3 → 3.3.0, `web-push` 3.0.1 → 3.1.0 (`openssl` 3.3.3 → 4.0.2 with it), `rqrcode` 2.2.0 → 3.2.0. Replaced Dependabot #166, #167, #168, which had fallen behind `production`. | none |
| #172 (merged 03 Oct) | Frontend patch updates: `@sentry/react` 11.1.0 → 11.4.0, `satori` 0.33.5 → 0.35.0, `vite` 8.3.1 → 8.3.2, `vitest` and `@vitest/coverage-v8` 5.0.2 → 5.0.3, `globals` 17.12 → 17.13. Backend: `aws-sdk-s3` → 1.233.1, `brakeman` 8.0.6 → 8.1.0, `good_job` 4.19.3 → 4.19.4, `pg` 1.6.3 → 1.7.0, `simplecov` 1.3.1 → 1.3.2. | none (entry 12.3 / 12.4 kB, initial JS 106.6 / 106.6 kB) |
| #174 (merged 03 Oct) | **Majors.** `lucide-react` 0.487 → 1.51 (183 import sites, no code change; the shared icon runtime chunk grew 10.5 → 11.4 kB gzip). `motion` 12.23 → 14.0 (no API change for `FloatingCard`, `CursorGlow`). `react-resizable-panels` **removed**: its only wrapper (`ui/resizable.tsx`) was dead code and the v4 API renamed everything. | initial JS budget 106.6 → 108 kB with the dated reason in `bundle-budget.json`; CSS fell 28.0 → 27.7 kB. (#175 later folded the preloads into the entry and reset initial JS to 105.7 kB.) |

Also merged this week, not upgrades but relevant to the budgets the upgrade PRs run against:
#173 (edge caching, R2 read domain), #175 (AVIF hero, fewer chunks, speed gate
`scripts/perf/budget.json`), #176 (hot-query indexes, GoodJob pools, sitemap job), #179 (indexed
search). #164 configured Dependabot: React moves as one group, TypeScript majors are ignored.

Open at the time of writing:

- **#178** Node 22 → 24 and Ruby 3.3.6 → 3.4.5. Both Vercel projects were already switched to
  Node 24.x through the API; CI, `.nvmrc`, `engines`, `backend/.ruby-version`, `Gemfile` and the
  Dockerfile move in the PR. 961 Vitest and 2020 Rails tests green on the new runtimes.
- **#177** Dependabot: `react-dom` and `@types/react-dom` 18 → 19.3 (the `react` group). On hold,
  see below.
- **#170** Dependabot: `react-resizable-panels` 2.1.7 → 4.14.1. Obsolete: #174 removed the
  package. Close it.

## On hold, and why

| Upgrade | Why not yet | What unblocks it |
| --- | --- | --- |
| **TypeScript 7** | `typescript-eslint` 8.71 declares `typescript >=4.8.4 <6.1.0`. Installing TypeScript 7 breaks `npm run lint` (seen on #87). Dependabot ignores TypeScript majors for this reason (`.github/dependabot.yml`). | A `typescript-eslint` release whose peer range includes 7. Then bump both in one PR and run every gate. |
| **ESLint 10** | Moves with TypeScript 7 so the lint toolchain changes once. `typescript-eslint` 8.71 and `eslint-plugin-react-hooks` 7.1 already accept `eslint ^10`, but `@eslint/js` and the flat config are pinned to the 9 line and get re-checked at the same time. | Same PR as TypeScript 7. |
| **React 19** (#177) | `react` and `react-dom` must move together with their types (the Dependabot `react` group does this). 19 changes `ReactDOM.render` semantics, `ref` as a prop, `useFormStatus`/actions and stricter hydration warnings; PR #180 adds server rendering of the first screen, which must be tested on 19 before 19 ships. Also every Radix package and `cmdk` need to be on versions that list React 19 as a peer. | Merge #180 first. Then a one-major-per-month slot: upgrade the group, run Vitest, the full Playwright suite on desktop and mobile, `check:split` and `check:perf`, and compare `bundle-budget.json` before and after. |
| **React Router 8** (8.4 is current on npm) | 7.18 is still supported. The route table (`src/app/routes.tsx`), `scripts/prerender-heads.mjs` and PR #180's server entry lean on the 7 data APIs, so this is a planned migration with its own PR, not a Dependabot merge. Doing it in the same month as React 19 would leave two candidates for any regression. | React 19 merged and settled for a month. Read the 8 upgrade guide, then take a one-major-per-month slot. |

## The monthly routine

**Dependabot (weekly, Monday).** `.github/dependabot.yml` opens grouped PRs against `production`:
`npm-minor-and-patch`, `bundler-minor-and-patch`, `github-actions`, and the `react` group. Limits:
3 npm, 3 bundler, 2 actions. TypeScript majors are ignored.

1. **Minor and patch, every week.** Whoever is on duty for the repo that week (the owner, or the
   planning agent when one is running) reviews the Dependabot PRs on Monday or Tuesday: read the
   changelog links, check CI is green on the PR, check `bundle-budget.json` and
   `scripts/perf/budget.json` did not need a change. Merge the same week. If a group PR has
   fallen behind `production`, use "Update branch" or recreate it as #171 did; do not rebase by
   hand onto a stale lockfile.
2. **One major per month.** First week of the month, the on-duty person picks **one** major from
   the "on hold" table or from Dependabot's ignored list and opens a hand-written PR:
   - title names the package and both versions;
   - body: the migration notes that applied, every code change, the bundle numbers before and
     after, and the gates run with counts (rule 9);
   - a budget raise, if any, is written into the budget file with the date and the reason
     (rule 4);
   - the full gate list runs locally first (rule 8), then CI, then review, then merge.
   One major a month keeps blame narrow: if something regresses in production, there is one
   candidate.
3. **Runtimes twice a year.** Node and Ruby move together in one PR (as #178), because Vercel's
   Node version, CI's `setup-node`/`setup-ruby`, the Dockerfile and `engines` have to agree.
   Check the provider still offers the version: Vercel's supported Node list and Railway's
   base image.
4. **Security advisories at once.** `npm audit --omit=dev --audit-level=high` and
   `bundler-audit` run in CI on every PR. A red `security` job on `production` is fixed the same
   day, outside the monthly slot, by the on-duty person.
5. **Record it here.** After each merge, add a row to "Upgraded this week" (rename the section by
   month once it grows) and move the entry out of "On hold". This file is the log; the PRs are
   the detail.

## Checklist for any upgrade PR

- [ ] Changelog read; breaking changes listed in the PR body.
- [ ] `npm ci` / `bundle install` from the lockfile in the PR; no `--legacy-peer-deps`.
- [ ] `npm run lint`, `format:check`, `typecheck`, `npx vitest run`, `npm run build && npm run
      check:bundle`, `npm run check:perf`, `npm run check:split`.
- [ ] Playwright on `chromium-desktop` and `chromium-mobile` for the areas the package touches
      (all of `tests/e2e` for React, Router, Radix or Tailwind).
- [ ] `bin/rails test` and `bundle exec brakeman -q` for any gem change.
- [ ] Bundle and speed budgets unchanged, or raised in this PR with the reason in the file.
- [ ] No new runtime dependency slipped in with the upgrade (check the lockfile diff).
