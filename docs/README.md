# Verse documentation

Start with the [repository README](../README.md). Operational documents stay at the root;
everything else lives here.

## The plan

- [VERSE_PLAN.md](VERSE_PLAN.md): **the only planning document** — thesis, production facts, market benchmark, findings register, design direction, the showcase demo data, execution briefs, owner actions and roadmap. Every change of direction edits this file.

## Root

- [README.md](../README.md): what Verse is, local setup, tests.
- [DEPLOYMENT.md](../DEPLOYMENT.md): Vercel/Railway configuration, environment variables, provider go-live checklists, release gate, backups.
- [ARCHITECTURE.md](../ARCHITECTURE.md): system layout, security boundary, domain model.
- [SECURITY.md](../SECURITY.md): security controls in place and still missing.
- [AUDIT.md](../AUDIT.md): production audit, gap register, and dated status updates.
- [ATTRIBUTIONS.md](../ATTRIBUTIONS.md): third-party component licences.

## Engineering

- [engineering/RUNBOOK.md](engineering/RUNBOOK.md): incident runbook for site down, payments, email, restore from backup, and security incidents.
- [API.md](API.md): API contract (routes, roles, status codes, error shape) and the tests that enforce it.
- [engineering/SAAS_BILLING.md](engineering/SAAS_BILLING.md): plans, entitlements, Razorpay event handling, reconciliation, cancellation rules.
- [engineering/SEARCH.md](engineering/SEARCH.md): how `/api/search` works (PostgreSQL, synonyms, limits) and its known limits.
- [engineering/SESSIONS.md](engineering/SESSIONS.md): session expiry and browser binding, admin two-step sign-in, and the HttpOnly cookie migration plan.
- [PERFORMANCE.md](PERFORMANCE.md): bundle budget, Core Web Vitals, tracing defaults, request timing logs, and load-test results.
- [RAILS8_UPGRADE.md](RAILS8_UPGRADE.md): the Rails 7.2 → 8.1.4 upgrade and the framework defaults now in effect.

## QA

- [qa/TESTER.md](qa/TESTER.md): the live admin tester, Rails and Playwright suites, and CI jobs.
- [qa/QA_CHECKLIST.md](qa/QA_CHECKLIST.md): manual pre-release browser checklist.

## Product

- [product/PRODUCT_BLUEPRINT.md](product/PRODUCT_BLUEPRINT.md): product thesis, user groups and core modules.
- [product/BAND_BOOKING_BLUEPRINT.md](product/BAND_BOOKING_BLUEPRINT.md): the hire / book / build model for bands and live crews.
- [product/REQUIREMENTS.md](product/REQUIREMENTS.md): candidate, employer and admin requirements.
- [product/ROADMAP.md](product/ROADMAP.md): phased product roadmap.
- [product/MUSIC_ROLE_TAXONOMY.md](product/MUSIC_ROLE_TAXONOMY.md): role families served by `/api/taxonomy`.
- [product/TOUR_AND_GUIDE.md](product/TOUR_AND_GUIDE.md): first-run tour, `/guide`, `/start` and search as onboarding.

## History

Written for the v0.x Node/SQLite prototype; kept for context, not a description of today's system.

- [history/LAUNCH_HARDENING.md](history/LAUNCH_HARDENING.md): v0.3.0 launch-hardening notes.
- [history/V0.5_RELEASE_NOTES.md](history/V0.5_RELEASE_NOTES.md): v0.5.0 release notes.
