# Settings: every business value, in one place each

Rule 2 of the engineering rulebook: anything that changes (fees, prices, flags, lists, limits) lives
in one config file with one documented update path, never as a literal in code. This page is the
inventory: where each value lives, who reads it, and how it reaches the frontend.

## How it works

- Every file below is loaded by **`Settings`** (`backend/app/services/settings.rb`): read once per
  process, env-scoped (`default:` + `development/test/production` with YAML aliases) or flat, and
  **validated at boot** (`config/initializers/settings.rb` calls `Settings.validate_all!`) against
  the schema in `Settings::FILES`: required keys and types, fee and refund ranges, plan fields,
  positive-integer limits, flag shapes. A bad edit fails the deploy with the key named.
- Each file has one small reader with named accessors, so a call site says what a number means:
  `BookingFeePolicy`, `PlanCatalog`, `Limits`, `Catalog`, `Features`, `AiPricing`, `BillingConfig`,
  `LegalConfig`, `EdgeCache`, `Seo::Pages`. Nothing reaches into raw hashes.
- The frontend never keeps its own copy: **`GET /api/public/config`** (`PublicConfigController`,
  `PublicConfig.payload`) serves fees, plans, limits, catalogue lists and the anonymous feature
  flags. No queries; anonymous responses are edge-cached per `config/edge_cache.yml` (`config`:
  s-maxage 300) and `vercel.json` proxies `/api/public/config` so the SPA reads it same-origin
  (`viaEdge`). The client store is `src/app/lib/publicConfig.ts` (`usePublicConfig()`,
  `getPublicConfig()`), with `FALLBACK_CONFIG` as a build-time copy for first paint only; the
  server body replaces it wholesale once it lands. Per-user feature flags come with `GET /api/me`
  and every sign-in answer (`features`), see `docs/ops/feature-flags.md`.
- Changing a value: edit the YAML, run `bin/rails test test/services/settings_test.rb
  test/integration/public_config_test.rb`, deploy. Production loads the files at boot; the edge
  copy of `/api/public/config` refreshes within five minutes. Update the matching
  `FALLBACK_CONFIG` entry in `src/app/lib/publicConfig.ts` when a first-paint value changes (the
  Vitest `publicConfig.test.tsx` pins the shipped values).

## The files

| File | Reader | Holds | Reaches the frontend via |
|---|---|---|---|
| `config/bookings.yml` | `BookingFeePolicy` | **Booking fee**: `platform_fee_percent` (0 = off), `fee_paid_by`, `min_fee_inr`, `gst_percent`, `policy_version`; **cancellation rules**: `full_refund_days`, `partial_refund_days`, `partial_refund_percent`; no-show outcomes | `/api/public/config` `fees` (numbers + `plainEnglish`), `/api/legal/*`, quotes and payments carry `feePercent`/`policyVersion` |
| `config/plans.yml` | `PlanCatalog` (= `Billing::BillingController::PLANS`, `PlanPricing`, `Entitlements`) | **Plan prices** (monthly/annual INR), trial days, capacity (`active_posts`, `seats`, `shortlist`, `bookings`) | `/api/billing/plans`, `/api/public/config` `plans`; `src/app/pages/Pricing.tsx` `FALLBACK_PLANS` is the first-paint copy |
| `config/ai_pricing.yml` | `AiPricing` | **AI credit prices** (top-up packs, AI Plus), allowances, task costs, launch limits (5 lifetime / 10 monthly), **the ₹1,500 monthly spend cap** (`budgets.hard_monthly_budget_inr`), provider and model pricing | `/api/ai/pricing`, `/api/ai/usage` (spend caps are server-only) |
| `config/billing.yml` | `BillingConfig` | **Promo rules**: Early Access seats/days, code format, referral discount/duration/reward cap | `/api/billing/*`, admin Codes tab |
| `config/limits.yml` | `Limits` | **Product limits**: live sessions per account (10), public portfolio items shown (8), portfolios per owner (20), list/admin page sizes and ceilings, search max results, message length, roles per job, push devices | `/api/public/config` `limits` |
| `config/catalog.yml` | `Catalog` | **Fixed lists**: opportunity kinds, workplaces, currencies, act/event/engagement types, role categories, instruments, **launch cities** | `/api/taxonomy`, `/api/public/config` `catalog.launchCities` |
| `config/seo_pages.yml` | `Seo::Pages` | **Cities and hire roles** behind `/hire/:role/:city` and `/rates/:city` | `/api/public/hire-pages/*`, `/api/public/config` `catalog.cities`/`catalog.hireRoles` |
| `config/search_taxonomy.yml` | `Search::Taxonomy` | Roles, genres, instruments people post and filter with | `/api/taxonomy` |
| `config/features.yml` | `Features` | **Feature flags**: `enabled`, `percentage`, `allowlist` per flag | `/api/me` (per user), `/api/public/config` (anonymous); `docs/ops/feature-flags.md` |
| `config/legal.yml` | `LegalConfig` | Legal entity, GST, invoice fields, grievance officer | `/api/legal/*`, invoices |
| `config/edge_cache.yml` | `EdgeCache` | CDN lifetimes per public endpoint | response headers (`docs/ops/edge-caching.md`) |
| `config/rate_limits.yml` | rate-limit concern (B5 lane) | Request throttles | n/a |
| `config/urgent.yml`, `images.yml`, `audio.yml` | R7 / R6 lanes | Urgent matcher weights, media processing | n/a |

## Inventory: hard-coded business values found (9 Oct 2026)

Moved into config in this change (constants keep their names and now read `Limits`/`Catalog`/`PlanCatalog`):

| Value | Was | Now |
|---|---|---|
| Plans: prices, trial days, capacity | `Billing::BillingController::PLANS` literal | `config/plans.yml` |
| Live sessions per account (10) | `AuthController::MAX_LIVE_SESSIONS = 10` | `limits.yml` `auth.max_live_sessions` |
| Public portfolio items on compare (8) | `TalentController` `.limit(8)` | `limits.yml` `portfolio.public_items_shown` |
| Portfolios per owner (20) | `Portfolio::MAX_PER_OWNER = 20` | `limits.yml` `portfolio.max_per_owner` |
| List page size 30 / max 100 | `ListPaging`, `JobsController` | `limits.yml` `paging.*` |
| Admin page size 50 / max 100 | `AdminPagination` | `limits.yml` `paging.admin_*` |
| Global search results (60) | `SearchController::MAX_RESULTS` | `limits.yml` `search.max_results` |
| Message length (5000) | `MessagesController::MAX_LENGTH` | `limits.yml` `messages.max_length` |
| Roles per job (6) | `JobsController::MAX_ROLES` | `limits.yml` `jobs.max_roles` |
| Push devices per account (10) | `PushController::MAX_SUBSCRIPTIONS_PER_USER` | `limits.yml` `push.max_subscriptions_per_user` |
| Act/event/engagement types, role categories, instruments, kinds, workplaces, currencies | `CatalogController` literals | `config/catalog.yml` |
| Feature flags | `VITE_FEATURE_*` build-time only | `config/features.yml` + `FEATURE_*` env, served by the API |

Already in config before this change (verified, left where they are): booking fee % and
cancellation rules (`bookings.yml`), AI credit prices and the ₹1,500 cap (`ai_pricing.yml`),
promo/referral/Early Access rules (`billing.yml`), SEO cities and roles (`seo_pages.yml`).

Still hard-coded, with the follow-up (kept out of this change to stay inside the lane's files or
because they are UI copy rather than enforced values):

| Value | Where | Follow-up |
|---|---|---|
| `MESSAGE_MAX_LENGTH = 5000` | `src/app/pages/Messages.tsx` (S5 lane) | read `usePublicConfig().limits.messageMaxLength` |
| `CITIES` (8 chips) | `src/app/components/JobFilterChips.tsx` | read `catalog.cities` (16 cities: product decision on which to show) |
| `LAUNCH_CITIES = ['Mumbai']` | `src/app/components/landing/LandingHero.tsx` | read `catalog.launchCities` |
| `HIRE_ROLES` | `src/app/lib/landing.ts` (mirrors `seo_pages.yml`, pinned by `seoPages.test.ts`) | read `catalog.hireRoles` |
| `FALLBACK_PLANS` | `src/app/pages/Pricing.tsx` | first-paint copy by design; could import `FALLBACK_CONFIG.plans` |
| `PER_PAGE = 25 / 50` | `src/app/pages/admin/CodesTab.tsx`, `UsersTab.tsx` | read `limits.adminPageSize` |
| `MAX_ROLE_CHIPS = 6` | `src/app/lib/roleFilter.ts` | read `limits.jobMaxRoles` |
| Budget bands (₹5k/10k/25k/50k) | `src/app/lib/urgentForm.ts`, `TalentFacets.tsx` | a `budget_bands` list in `catalog.yml` |
| `MAX_LINKS = 8` (link import), `MAX_ITEMS = 8` (library import), `MAX_LINKS = 5` (onboarding) | `LinkImportController`, `LibraryImportsController`, `src/app/lib/onboarding.ts` | `limits.yml` `imports.*` |
| Route-level flag reads | `src/app/routes.tsx` filters routes with the build-time `FEATURE_*` constants at module load | a `FeatureGate` route wrapper so a server kill switch also hides the page, not only its links |
| Technical limits (`MAX_BATCH`, byte sizes, retry counts) | various | engineering constants, not business values; left in code on purpose |
