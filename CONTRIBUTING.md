# Contributing to MusiLynk

One page. The full rulebook is [docs/engineering/RULES.md](docs/engineering/RULES.md); read it
once before your first change. The system map is
[docs/engineering/ARCHITECTURE.md](docs/engineering/ARCHITECTURE.md).

## Before you start

- Branch from `origin/production`. Name it after the task.
- Do only the task. Note anything else you see in the PR body under "Proposals".
- Anything that changes (brand, legal, fees, limits, lists) goes in a config file with a
  `docs/ops` page, not in code. The list of files is in RULES.md.
- A new runtime dependency needs a paragraph in the PR body: size, maintenance, the
  alternative you considered.
- A new env var is optional, the feature is off when it is unset, and it is documented in
  `docs/ops` by name only.

## Run the gates

Frontend, from the repository root:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npx vitest run
npm run build && npm run check:bundle
npm run check:perf            # needs: npx playwright install chromium-headless-shell
npm run check:split
npx playwright test tests/e2e/<the specs you touched> --project=chromium-desktop --project=chromium-mobile
```

Backend, in `backend/` with a test database loaded from the schema (not seeds):

```bash
bundle install
RAILS_ENV=test bin/rails db:create db:schema:load
bin/rails test test/<the files you touched> test/integration/api_matrix_test.rb
bundle exec brakeman -q
```

Every gate green before you push. CI runs the same set
(`.github/workflows/rails-and-web.yml`, `.github/workflows/qa-agent.yml`); the five required
checks on `production` are `frontend`, `rails`, `security`, `integrated-journeys` and
`local-experience`.

## Tests

- Every endpoint: auth, authorisation, validation, happy path, and a query-count assertion
  (`assert_queries_at_most`).
- Every UI change: a unit test plus Playwright on desktop and mobile.
- Never skip, weaken or delete a test to get green. If a test encoded the old behaviour, change
  it and say why in the commit message.

## Budgets

Bundle size (`bundle-budget.json`), page speed (`scripts/perf/budget.json`), query counts and
accessibility are hard limits. Prefer lazy-loading to raising a budget. If you must raise one,
do it in a PR whose purpose is that growth and write the reason and the measurement into the
budget file.

## Pull requests

- Target `production`. Title 70 characters or fewer.
- Body, in this order: what changed (user-visible first), why, how you verified it (commands and
  counts), env vars by name, budget changes.
- Migrations: reversible, backward-compatible with the running release, `db/schema.rb`
  committed. A destructive migration needs a backup step and a written rollback.
- No secrets anywhere: code, logs, commits, PR text, client env.
- Red CI is yours to root-cause. "Flake" is not a root cause.
- Dependabot PRs: minor and patch updates land weekly in groups; one major upgrade per month,
  by hand ([docs/UPGRADES.md](docs/UPGRADES.md)).
- The reviewer merges, not the author. Railway deploys the backend after the required checks
  pass on the merge commit; Vercel deploys the frontend on merge.

## After merge

Check `/api/health` on the API shows the new commit, open the site once, and glance at Sentry.
If something is wrong, use [docs/ops/RUNBOOKS.md](docs/ops/RUNBOOKS.md) and
[docs/engineering/RUNBOOK.md](docs/engineering/RUNBOOK.md).
