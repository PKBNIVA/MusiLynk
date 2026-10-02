# MusiLynk

MusiLynk is a music-industry careers, hiring and live-booking marketplace, built first for India.
Musicians, engineers and crew build a profile with work samples and find jobs, gigs, sessions
and tours. Employers, studios, venues and bands post opportunities, search talent, assemble
line-ups and book acts with a Razorpay deposit. Paid plans unlock more hiring capacity.

- Web: https://verse-music-platform.vercel.app
- API: https://verse-music-platform-production.up.railway.app/api
  ([live](https://verse-music-platform-production.up.railway.app/api/live) ·
  [health](https://verse-music-platform-production.up.railway.app/api/health) ·
  [readiness](https://verse-music-platform-production.up.railway.app/api/readiness))

## Architecture in five lines

1. `src/`: React 18 + TypeScript single-page app built with Vite 8, hosted on **Vercel**.
2. `backend/`: Rails 8.1 JSON API under `/api`, run on **Railway** from `backend/Dockerfile`.
3. **PostgreSQL** on Railway holds the data, the GoodJob job queue and the rate-limit cache.
4. Razorpay (payments), Brevo (email), Cloudflare R2 (uploads) and Sentry (errors) plug in
   through environment variables; each stays off until configured.
5. GitHub `production` is the release branch: pull requests run CI, and merges deploy to
   Vercel and Railway.

Details: [ARCHITECTURE.md](ARCHITECTURE.md).

## Run it locally

Needs Node 22, Ruby 3.3.6 (`backend/.ruby-version`) and a running PostgreSQL (CI uses 16).

```bash
npm ci

cd backend
bundle install
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/musilynk_development  # your local Postgres user/password
bin/rails db:prepare        # creates the database, loads the schema, seeds demo accounts
bin/rails server            # API on http://localhost:3000
```

In a second terminal, from the repository root:

```bash
npm run dev                 # web app on http://localhost:5173, proxies /api to :3000
```

Seeded development accounts (not created in production): `admin@musilynk.local` / `Admin@12345`,
`studio@musilynk.local` / `Employer@123` (employer), `artist@musilynk.local` / `Artist@123`
(professional). Without an email provider, sign-in codes are shown in the API response as
`debugCode` in development.

`/api/readiness` also wants `FRONTEND_URL` and `ALLOWED_ORIGINS`; export
`FRONTEND_URL=http://localhost:5173 ALLOWED_ORIGINS=http://localhost:5173` before
`bin/rails server` if you need it green. To rehearse payments without Razorpay credentials,
see the simulator in [DEPLOYMENT.md](DEPLOYMENT.md#local-rehearsal-without-credentials-razorpay-simulator).

## Run the tests

```bash
# API (uses a separate test database)
cd backend
RAILS_ENV=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/musilynk_test bin/rails db:prepare
RAILS_ENV=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/musilynk_test bin/rails test
bin/rails zeitwerk:check
bundle exec brakeman --no-pager --exit-on-warn --exit-on-error
bundle exec bundler-audit check --update

# Web (from the repository root): the same commands CI runs
npm run typecheck && npm run lint && npm run format:check
npm run build && npm run check:bundle && npm run check:split
npm run test:all            # frontend source smoke tests
npm run test:unit -- --coverage   # Vitest unit tests for src/app/lib, with a coverage floor
npm audit --omit=dev --audit-level=high
npx playwright install chromium
npm run qa:e2e              # browser tests against a local preview with a mocked API
```

CI (`.github/workflows/rails-and-web.yml` and `qa-agent.yml`) runs all of these on every pull
request, plus real browser journeys against Rails and PostgreSQL. What each layer covers:
[docs/qa/TESTER.md](docs/qa/TESTER.md).

`backend/Gemfile.lock` and `backend/db/schema.rb` are committed. After a migration, run
`bin/rails db:migrate` and commit `db/schema.rb` (CI fails if it is stale). After changing the
Gemfile, run `bundle lock` and commit the lockfile (the Docker build is frozen).

## Documentation

| Document | What it covers |
| --- | --- |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel and Railway setup, environment variables, provider go-live checklists, release gate, backups |
| [docs/engineering/RUNBOOK.md](docs/engineering/RUNBOOK.md) | What to do when the site, payments or email break; restoring a backup; security incidents |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System layout, security boundary, domain |
| [SECURITY.md](SECURITY.md) | Security controls in place and still missing |
| [AUDIT.md](AUDIT.md) | Production audit, gap register and current status |
| [docs/API.md](docs/API.md) | API contract: routes, roles, errors |
| [docs/README.md](docs/README.md) | Index of every other document (product, engineering, QA, history) |

The legacy Node/Render line on the `main` branch is not the production application; do not
deploy `main` or `render.yaml`.
