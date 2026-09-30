# Verse — master plan and memory

**This is the only planning document.** It supersedes `docs/LAUNCH_READINESS.md`, `docs/UX_OVERHAUL_PLAN.md`, `docs/ux/WAVE1_BRIEF.md`, `docs/product/MARKET_RESEARCH.md`, `docs/product/PRODUCT_AUDIT.md` and `docs/product/PRODUCT_EXPERIENCE.md`, all deleted in the commit that added this file. Everything still true from them is here; everything not here was either shipped or dropped. Written 2026-09-30 from the production head `025c524`, a re-read of the whole codebase, a market benchmark of nine platforms, and a ten-lens crawl of every screen of a production-mode copy seeded with 1,000 demo accounts.

**How to keep it true.** Every change of direction edits this file in the same PR. Dates and PR numbers go in §1.3 (build state). Findings get an ID in §4 and are struck through with the PR that fixed them, never deleted. A brief in §7 is the contract an implementing agent works from; it is not rewritten by the agent. The division of labour is fixed: the product owner's assistant (Fable) decides, briefs and reviews; implementing agents (Sonnet by default) execute a brief without choosing layout, copy or scope; Haiku is used only for mechanical sweeps named in a brief.

---

## 1. What Verse is, and where it stands

### 1.1 Thesis (unchanged, confirmed by the benchmark)

Verse is an Indian marketplace where a hirer finds a **verified musician for a session or gig within 24 hours**, and a musician gets **found by the work they can prove**, not by a résumé. Mumbai first; musicians free during beta; hirers on flat plans (Free / Pro ₹2,499 / Studio ₹5,999 monthly, annual ₹24,990 / ₹59,990); never per-lead charges; no silent renewals; a booking fee only on completed bookings and only once bookings exist. Early Access Pro (50 seats × 90 days) is the launch offer. These are the fixed points; §9 lists what may change them and when.

Resolved contradictions from the old plans (the code is the truth):
- **Stage (community feed) is ON at launch, signed-in only** (`src/app/lib/features.ts` `FEATURE_STAGE` defaults on). The old "dark until 200 verified musicians" rule is dropped; public reading of the Stage stays off until ≥ 2,000 posts.
- **AI uses OpenAI by default** (`backend/config/ai_pricing.yml` `provider: openai`, `AI_PROVIDER` overrides; the launch mode allows four tasks with 5-lifetime / 10-monthly caps). Turning AI on in production means `OPENAI_API_KEY`, not `ANTHROPIC_API_KEY`.
- **Resumes / career record stay off** (`FEATURE_RESUMES` default off) until the Mumbai beta shows demand.
- **Role × city hire pages and rates pages are built** (`/hire/:role/:city`, `/rates/:city`; 12 roles × 16 cities in `backend/config/seo_pages.yml`); what remains is real copy and the ≥ 10-profiles-per-page thin-content rule.

### 1.2 Production, as it actually is (2026-09-30, release `025c524`)

| Fact | Evidence |
|---|---|
| The marketplace is **empty**: 1 professional (the owner), 0 jobs, 0 acts, 0 verified, 0 urgent requests | live `/api/public/stats`, `/api/public/talent`, `/api/jobs` |
| `/api/readiness` returns **503 NOT_READY** while `/api/health` is 200 and CI is green | live; `backend/app/services/readiness_checks.rb` |
| **Cause of the 503**: the web service's `ADMIN_PASSWORD` is 13 characters; the required check demands ≥ 14 in production. The worker service has a different, 24-character value. Nothing else required is missing (FRONTEND_URL, ALLOWED_ORIGINS, SEED_DEMO_DATA, database all pass; jobs run on the separate worker with `GOOD_JOB_EXECUTION_MODE=external`) | Railway variable names/lengths read via GraphQL (values never read); `readiness_checks.rb:14` |
| Email works (Brevo key, sender and webhook secret set); uploads go to R2 (`AWS_*` + `PERSISTENT_UPLOADS`); Sentry set; admin site locked to `ADMIN_ORIGIN` | Railway variable names; live `/api/auth/methods` |
| Razorpay is configured with **test-mode keys** but `RAZORPAY_ALLOW_TEST_MODE` is absent, so checkout is refused ("Payments unavailable"); no annual plan ids, no referral offer id | variable names (`RAZORPAY_KEY_ID` is 23 chars = `rzp_test_…`); live `/api/billing/plans` `annualAvailable:false` |
| Off in production: AI (`OPENAI_API_KEY`), Google sign-in (`GOOGLE_OAUTH_*` + `ACTIVE_RECORD_ENCRYPTION_*`), WhatsApp (`WHATSAPP_*`), YouTube/Spotify import keys | variable names; live `/api/ai/status`, `/api/auth/methods` |
| Legal pages serve placeholders `[LEGAL ENTITY NAME]`, `[NAME]`, `[EMAIL]`, `[ADDRESS]` | `backend/config/legal.yml`; live `/api/legal/policy` |
| Both Vercel projects auto-deploy `production` merges (git source; manual API deploys are quota-limited to 100/day on the free plan) | Vercel API |
| Railway deploys `production` after CI; the web service supports a one-off `preDeployCommand` (settable via API, currently null) | Railway GraphQL |

### 1.3 Build state (append-only)

| PR | What | Merged |
|---|---|---|
| #107 | SEO pack: sitemap, share pages, canonical/OG/JSON-LD, prerendered heads | 2026-09-29 |
| #109, #114 | Launch fixes (V-02…V-16), session hydrate, 402 plan-limit dialog | 2026-09-29 |
| #110 | Hire role × city pages, rates pages | 2026-09-29 |
| #111 | Early Access Pro, trial/renewal reminders | 2026-09-29 |
| #115 | Marketplace mechanics: urgent expiry, deadline auto-close, review prompts, fast-responder badge, Stage system posts | 2026-09-29 |
| #118 | hire-pages spec fix | 2026-09-29 |
| #119 | Lifecycle emails + weekly digest, Google sign-in, paste-a-link import, community Stage | 2026-09-29 |
| #120 | Promo/referral/extended-trial codes, annual plans, admin Codes tab | 2026-09-29 |
| #121 | Verification automation (score, auto-approve ≥ 75, Verified Pro, audit sample) | 2026-09-29 |
| #122 | AI provider abstraction, OpenAI default | 2026-09-29 |
| #123 | UX Wave 0: PageHeader, collapsed help, no tour modal/toast, grey Demo badge, fit ≥ 60, nav by role, favicon, /login redirect | 2026-09-30 |
| #124 | Two time-of-day flaky tests pinned | 2026-09-30 |
| #125, #126, #127 | UX Wave 1: shared kit (UserAvatar, FormatGlyph, PlayChip, EmptyState + 8 scenes, StatChips), dashboards around "needs you now", row job cards + filter chips, profile/job heroes with sticky CTA, talent/applicant cards, directory chips, landing avatar row | 2026-09-30 |
| #128 | The three superseded planning docs | 2026-09-30 |

---

## 2. Market benchmark (read 2026-09-30; confidence noted)

| Platform | Hero | Cards | Profile media | Trust signals on card | Fees | Confidence |
|---|---|---|---|---|---|---|
| SoundBetter | photo + video | photo, rating + count, embedded player, credits | cover image, playlists, verified reviews, "Contact for pricing" | stars, review count, "Online now" | buyer 0%; provider 5% + ~3% | high (fee medium) |
| AirGigs | full-width photo | image-first, "From $75", provider + location | 10+ players, Spotify, video | verified reviews, response time, 100% guarantee, Top Rated badge | seller 8–15%, escrow | high |
| Fiverr (music) | — | cover image, level badge, rating, "From $X", delivery | — | levels, rating | seller 20% + buyer 5.5% | medium (blocked) |
| GigSalad | — | photo, rating, "Top Performer" | photos/videos/audio, reviews | 4.8+ & 80 % replies < 24 h & ≥ 1 booking ⇒ ranking priority | provider 5 % / 2.5 %; client 10–12 %; $359–479/yr | high (help centre) |
| The Bash | party photo, "525,000+ events booked" | photo, rating + count, "395 verified bookings", "Starting at $675" | gallery/video | verified bookings, online-payments badge, money-back guarantee | 5 % on booking ($20 min), $129–219/yr | high |
| Encore (UK) | text hero, "quote time under 30 min", "33,000 five-star reviews" | photo, "From £350–475", review count, "Usually within 30 minutes" | videos | reviews, response time, free 48 h cancellation, no hidden fees | musician 20 % on booking | high |
| StarClinch (India) | event-type image tiles, "Express Booking" | photo, duration, languages, city, no price | photo/video gallery, price behind "See price & book", no visible reviews | "verified singers" copy only | artist 15 % | high |
| Instagram / YouTube | — | de-facto portfolio: YouTube 83 %, Instagram 58 % of superfans engage; "a raw live video is the #1 trust builder" | — | — | — | high |

What every one of them has and Verse lacks today: **a photo on every card and a photo or video in the hero; price on the card ("from ₹"); review count / bookings count / response time on the card; inline audio on the card; an explicit protection promise** (escrow, guarantee, free cancellation). Where Verse can beat the Indian incumbent (StarClinch): **transparent "from ₹" prices, visible real reviews, playable samples, and a 2-hour urgent promise** — StarClinch hides price and reviews behind a form. India-specific filters seen on StarClinch and missing here: language, event type, genre incl. Ghazal/Qawwali/Bhajan, budget band. Dark theme is an outlier (every benchmarked site is light) — kept for launch, see §5.1.

---

## 3. The diagnosis in one paragraph

The product is structurally sound and functionally deep (76 tables, ~190 API routes, verification automation, codes, lifecycle emails, urgent matching, community feed) but it presents as an empty, text-only admin tool: production has no data, no screen has an image, the one visual device is an initials disc, the landing hero is a gradient with a two-letter tile, prices and trust counts that exist in the database are never rendered, the demo data that was meant to make it look alive is templated and its media links are dead, and a first-time hirer or musician trips over dead ends the crawl found in both journeys (limits revealed after four steps, quotes that lose the musician, urgent responses that lead nowhere). Fixing the emptiness and the imagery is the largest single lever; fixing the journeys is the second; everything else is polish and hygiene.

---

## 4. Findings register

Severity: **P0** blocks a core task or leaks data · **P1** wrong or misleading on a core path · **P2** clearly worse than a good product · **P3** polish. Each finding names the brief in §7 that owns it. Struck-through entries are fixed (PR in parentheses).

### 4.1 Trust, safety, data

| ID | Sev | Finding | Evidence | Brief |
|---|---|---|---|---|
| T-01 | P0 | Public, unauthenticated talent/candidate JSON leaks `password_set_at`, `consented_at`, `phone_verified_at`, `vouched_by_id`, `email_verified`, `profile_complete`, `search_total` — the `except` list filters camelCase names while `as_json` emits snake_case columns | `backend/app/controllers/application_controller.rb:172-184`; live `/api/public/talent?perPage=1` | B0 |
| T-02 | P1 | Directory ranking is `verified DESC, created_at DESC`: with 0 verified profiles the newest, emptiest sign-up ("Empty Tester") tops Mumbai talent, ahead of every populated profile | `backend/app/controllers/talent_controller.rb:7`; live order | B2 |
| T-03 | P1 | Hidden (non-demo) synthetic profiles are reachable by direct URL and listed in the sitemap although listings hide them; sitemap and share pages apply no synthetic filter at all (local sitemap 1,472 URLs) | `talent_controller.rb:16-32`; `sitemaps_controller.rb:35-56`; `share_pages_controller.rb:12,27,43` | B0 |
| T-04 | P1 | Legal pages ship `[LEGAL ENTITY NAME]`, `[NAME]`, `[EMAIL]`, `[ADDRESS]`; DPDP grievance officer and GST fields unfilled | `backend/config/legal.yml:6-15`; live `/api/legal/policy` | B0 (guard) + owner |
| T-05 | P1 | "Verified" is promised on the hero, hire pages and the `verified=true` filter while zero verified musicians exist anywhere | crawl hirer-journey; live stats | B5 (showcase verification) + B3 (copy) |
| T-06 | P2 | Engineering copy live to the public: pricing pill "SaaS plans with server-enforced trials", toast "Mock deposit recorded", "Demo billing. Razorpay is not configured on this environment…", landing footnote "Test and demo accounts are never counted", raw "Live payments are not configured." dead end on deposits | `src/app/pages/Pricing.tsx:176`; `BookingDepositPanel.tsx:56`; `Billing.tsx:85-91`; `LiveProof.tsx:46`; crawl hirer-journey | B6 |
| T-07 | P2 | Demo acts expose placeholder `promo_url https://example.com/demo-…`; demo work samples are 12-char fake YouTube ids that render as dead links; demo project URLs point at `verse.example` | live `/api/public/acts`; `batch_seeder.rb:112-124`; `WorkSamplePlayer.tsx:28` | B5 |
| T-08 | P2 | Demo purge is incomplete: `posts`, `post_comments`, `post_reactions`, `follows`, `badges`, `review_prompts`, `urgent_request_notifications`, `vouches`, `career_entries`, `resumes`, `refund_records` are never deleted (non-cascading FKs ⇒ purge rolls back), and system Stage posts derived from demo activity survive | `synthetic_qa/batch_cleanup.rb:69-114`; `stage_system_posts_job.rb:26,52` | B5 |
| T-09 | P2 | Demo users are excluded from public stats and hire-page counts but included in the weekly digest, lifecycle emails, badge and review-prompt jobs, funnel metrics and the sitemap — inconsistent in both directions | `public_stats_controller.rb:15-25`; `seo/hire_stats.rb:12`; `weekly_digest_job.rb:11`; `funnel_queries.rb:52-74` | B5 |
| T-10 | P2 | Each demo employer files a `qa-test` report and a verification request; a 200-user batch floods admin queues (~50 open reports, ~50 pending verifications) | `batch_seeder.rb:192-197` | B5 |
| T-11 | P1 | Lifecycle emails claim the idempotency row before checking that a provider can deliver, so with no provider every onboarding step is burned and reported as sent | `lifecycle_sequences.rb:86-200`; `notifier.rb:52-82`; `lifecycle_email_delivery_job.rb:24-25` | B0 |
| T-12 | P1 | Funnel events `path_chosen`, `signup_started`, `signup_completed`, `profile_link_added` are defined but never fired; the admin Funnel tab reads 0 for steps 2–3 and retention is always null | `src/app/lib/analytics.ts:207-219`; `funnel_queries.rb:18-87` | B0 |
| T-13 | P2 | `profile_view` ingest runs an un-indexed jsonb COUNT per event | `events_controller.rb:42-55` | B0 |
| T-14 | P2 | Authorization probes (other users' profile/applications/conversations by id; other hirer's job edit) — results pending from the trust-privacy crawl lens | crawl (pending) | B0 |

### 4.2 Journeys (from the musician and hirer crawls)

| ID | Sev | Finding | Evidence | Brief |
|---|---|---|---|---|
| J-01 | P1 | Free-plan limit (1 active opportunity) is revealed only after all four wizard steps, as a 402 dialog | `src/app/pages/PostJob.tsx:197-200,381` | B4 |
| J-02 | P1 | Template placeholder text can be submitted, approved and published as a live listing | crawl hirer-journey (`/opportunities/:id`) | B4 |
| J-03 | P1 | Urgent-request responses give the hirer no way to message, accept or book the responder; responding starts no conversation on the musician side either | crawl both journeys (`/employer/urgent`, `/jobseeker/urgent`) | B7 |
| J-04 | P1 | "Request a quote" on a musician's profile drops into the generic book-talent page and loses the musician | crawl hirer-journey (`/professionals/:id`) | B2 |
| J-05 | P1 | Adding pay to a live listing silently takes it offline (back to review) with no warning | crawl hirer-journey (`/employer/post-job?edit=`) | B4 |
| J-06 | P1 | Deposit payment dead-ends in raw "Live payments are not configured."; "Start free trial" is enabled under a "Payments unavailable" banner and fails with a raw 503 | crawl hirer-journey | B6 + B7 |
| J-07 | P1 | Library "Add from a link" silently discards the link on Close; "Draft my profile from these links" produces an all-empty draft; a Spotify artist URL is labelled "Spotify track" | crawl musician-journey | B8 |
| J-08 | P1 | Public profile never shows the day/session/show rates that are stored and promised | crawl; `PublicProfile.tsx` | B2 |
| J-09 | P1 | Dashboard tells a musician to add work they already added (tour strip ignores state) | crawl musician-journey | B8 |
| J-10 | P1 | `/signup` redirects to `/join`, which is a 404 (the join routes are `/join/musician`, `/join/hiring`) | crawl; `routes.tsx` | B0 |
| J-11 | P1 | Urgent list renders every open request (148) unfiltered and unpaginated, for both roles | crawl both journeys | B7 |
| J-12 | P2 | After submitting an opportunity the hirer sees "In review" with no explanation or next step; the owner's job page shows no status, no actions, an empty side card | crawl hirer-journey | B7 |
| J-13 | P2 | Wizard ignores onboarding answers (city not prefilled, posts "as person" by default); saved draft not offered on reopen; limit shown twice | crawl hirer-journey | B4 |
| J-14 | P2 | Applicants view: misleading empty state, no link to the musician's public profile; Compare has no actions and duplicated chips | crawl hirer-journey | B7 |
| J-15 | P2 | Opening a profile or act from the hirer workspace ejects the hirer into the public site shell (public nav, "Sign in" buttons) | crawl hirer-journey | B2 |
| J-16 | P2 | Musician-side tools (Book & perform, availability) exposed to a wedding planner; musician's account menu is a 20-item hirer/musician mash-up; musicians see hirer plans on Billing | crawl both | B8 |
| J-17 | P2 | Own public profile offers "Message" and "Request a quote" to self | crawl musician-journey | B2 |
| J-18 | P2 | Profile: website without `https://` passes Review and fails on Save; unsaved edits lost without warning; verification request leaves no visible pending state; "How this works" panel clipped off the left edge | crawl musician-journey | B8 |
| J-19 | P2 | Two separate message threads with the same person (per job); US-format timestamps with seconds across the product | crawl both | B7 + B6 |
| J-20 | P2 | Find work ignores the musician's roles and city by default; urgent matching matches "Dholak" to "Dhol" by substring | crawl musician-journey | B8 + B7 |
| J-21 | P2 | Code-only accounts cannot set a first password; sign-in with a wrong method says "Incorrect email or password." | crawl both (`/jobseeker/settings`, `/auth/employer`) | B8 |
| J-22 | P2 | Legacy "Work samples" page (`/jobseeker/portfolio`) duplicates "My work" with doubled cards and is still linked from the tour, JobDetails and WelcomeNextStep | crawl; `routes.tsx:396-403` | B8 |
| J-23 | P2 | Stage feed dominated by repetitive system posts; "Employer reviews" page lets a new user rate no one; "Book talent" empty CTA shown to musicians | crawl musician-journey | B8 + B5 |
| J-24 | P2 | Public rates guide (`/rates/mumbai`) empty for every role; every act "From INR 25,000"; book-talent results ignore the hirer's city | crawl hirer-journey | B5 + B2 |
| J-25 | P2 | Booking-enquiry limit discovered only after filling the enquiry form; "Ask for changes" has no message field; policy block rendered twice | crawl hirer-journey | B7 |
| J-26 | P3 | Stale "Check your email for a 6-digit code" toast on the new dashboard; empty hirer dashboard repeats the same two CTAs three times; two different urgent forms (`/urgent` vs `/employer/urgent`) with different fields; uploaded PNG cannot be previewed on http; "a instrument" grammar; step tabs truncate to "What you…" | crawl both | B6 + B7 + B8 |

### 4.3 Presentation

| ID | Sev | Finding | Evidence | Brief |
|---|---|---|---|---|
| V-01 | P1 | No imagery anywhere: no photo/cover/logo field on any model; initials discs everywhere; landing hero is a CSS gradient with an "SD" tile; 40+ pages render zero images; 16 media tags in the whole frontend | `kit/UserAvatar.tsx:32`; `landing/LandingHero.tsx:30,112-150`; `db/schema.rb` | B1 + B3 |
| V-02 | P1 | Landing proof rows and the hero "verified" row hide below thresholds (≥ 10 verified, ≥ 2 cities, ≥ 5 open) and demo accounts are excluded from `/public/stats`, so the first screen is text-only even with demo data | `src/app/lib/landing.ts:16-40`; `LandingHero.tsx:180-185`; `public_stats_controller.rb` | B3 |
| V-03 | P1 | Cards show no price, review count, bookings count or response time although rates are stored and exposed (`sessionRate`, `showRate`, `dayRate`) | `apiTypes.ts:50-54`; `CandidateSearch.tsx:240-330`; `PublicTalent.tsx`; `PublicProfile.tsx` | B2 |
| V-04 | P2 | Three different `EmptyState` components across 26 call sites; nav avatar uses a fixed fuchsia letter while cards use the kit avatar; Stage authors are single letters | `kit/EmptyState.tsx`, `help/EmptyState.tsx`, `admin/ui.tsx:210`; `Navigation.tsx:317-321`; `post.rb:177-179` | B1 |
| V-05 | P2 | Share pages for jobs, professionals and acts always use `og-default.png`; WhatsApp/LinkedIn previews never show the musician or job | `share_pages_controller.rb:21,37,52` | B3 |
| V-06 | P2 | Public `/urgent` page renders the signed-in Navigation; 404 page prints the raw path in monospace and uses an off-palette gradient; `index.html` lacks theme-color, touch icons, manifest, document-level og tags | `UrgentHire.tsx`; `NotFound.tsx:13-21`; `index.html` | B3 + B6 |
| V-07 | P2 | Hire/rates pages render `noindex` until the API answers and are not prerendered; Googlebot never reaches share pages (only social UAs are rewritten) | `HirePage.tsx:89`; `RatesPage.tsx:83`; `vercel.json:9-27` | B3 |
| V-08 | P2 | Public rates page copy and "From INR" formatting are inconsistent (`INR 8000`, `₹25,000`, "/ per project" fixed in #127) | crawl | B6 |
| V-09 | P3 | `public/` assets have no cache header; bundle budget ignores images; dead `figma/ImageWithFallback.tsx`; stray `dist-*` build dirs not ignored | `vercel.json`; `.gitignore` | B0 |

### 4.4 Quality infrastructure

| ID | Sev | Finding | Evidence | Brief |
|---|---|---|---|---|
| Q-01 | P1 | The only axe/WCAG run that sees populated directory pages is the nightly live run; its last run (2026-09-29) failed on `/music-professionals`, `/music-jobs`, `/book-music`, and Wave 1 rewrote those cards since. Mocked fixtures return empty lists | `tests/e2e/accessibility.spec.ts`; `qa-helpers.ts:81-88`; run 36551389493 | B9 |
| Q-02 | P1 | Parallel Playwright runs collide on hard-coded ports 4173–4176 with `reuseExistingServer` on locally; undocumented | `playwright.config.ts:10,53,82-121` | B9 |
| Q-03 | P2 | `portfolio-uploads` and `payments-simulator` specs never run in CI; signed-in live smoke always skipped (no `QA_SMOKE_*` secrets); nightly cron fires 5–6 h late and failures alert no one | workflows; `live-account-smoke.spec.ts:25-28` | B9 + owner |
| Q-04 | P2 | Two specs hard-code a session-specific scratchpad path for screenshots; four smoke scripts are regex assertions over source text | `zz-landing-shots.spec.ts:5-6`; `tests/frontend-*-smoke.mjs` | B9 |
| Q-05 | P3 | README/DEPLOYMENT release gates omit half the CI checks; TESTER.md misplaces `npm audit` | `README.md:56-72`; `DEPLOYMENT.md:500-519` | B0 |

### 4.5 Pending lenses

Findings from the visual, copy, forms/bugs, mobile, visitor/SEO, admin, trust-privacy, performance and community lenses are appended here as they complete verification (§4.6). Until then, their known headline items are folded into the briefs above from the reader reports.

### 4.6 Additional confirmed findings (appended)

_(none yet)_

---

## 5. Direction: from menial to appealing

### 5.1 Visual system decisions

1. **Dark stays, and becomes "stage dark".** Every benchmarked site is light, but the cost of a light mode across 95 pages is high and dark suits music. The fix is not the theme; it is that nothing in the theme has anything to look at. Rule: **no content screen without at least one photograph, cover art, waveform or avatar in the first fold.** Light mode is deferred (§9).
2. **Three image layers, each honest about what it is:**
   - **Photography (editorial surfaces only).** A curated set of 20–30 real photographs of musicians at work — Indian contexts first (tabla, sitar, wedding band, studio vocalist, DJ, live sound desk, rehearsal room) — from Wikimedia Commons under CC BY / CC0 (CC BY-SA only when nothing else fits), each converted to WebP at 1600 and 800 widths, ≤ 160 KB, committed under `public/img/`, with a `/credits` page and `docs/IMAGE_CREDITS.md` listing file, author, licence and source URL. Used on: landing hero and sections, `/join/*`, `/hire/:role/:city` headers (per role), `/rates/:city`, `/pricing`, `/about`, `/guide`, empty-state backdrops on public pages. **Never attached to a person's profile** — a real face on a fake or someone else's profile is a lie.
   - **Cover art (generated, deterministic).** `CoverArt` — an SVG component keyed by `opportunity_kind` + genre (jobs) or by genres + roles (profiles, acts): gradient field + waveform ribbon + glyph, unique per entity via a hash. Used on job rows, job hero, act cards, portfolio tiles without a thumbnail, Stage posts without media, and as the **avatar for demo profiles** (`ArtAvatar`), so demo people look designed rather than faceless without impersonating anyone.
   - **Real user media.** New `profiles.photo_url` and `acts.photo_url` (uploaded through the existing R2/Active Storage upload path, jpeg/png/webp only, square-cropped client-side to 512 px; Google's `auth_connections.avatar_url` is copied in on connect if the user has no photo). `UserAvatar` renders the photo when present, else initials. Work samples show YouTube/SoundCloud oEmbed thumbnails when they exist and a `WaveformStrip` (peaks from `media_metadata.waveform`, 64 ints) for audio.
3. **Price and trust on every card**, because every competitor does it and the data exists: "from ₹X" (the lowest of session/show/day rate, formatted `₹5,000`), review count with average when > 0, "N bookings" when > 0, "Replies in ~N min" when measured, Verified / Verified Pro badges, Demo chip when synthetic. Public profile hero gets the same plus a rate table.
4. **Ranking that rewards proof** (replaces `verified DESC, created_at DESC`): verified → has a playable sample → profile completeness ≥ 80 → has rates → recently active; empty profiles never outrank populated ones; hidden synthetic never listed.
5. **India-first filters**: language (Hindi, Marathi, Punjabi, Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati, English…), event type (wedding/sangeet, corporate, private party, concert/festival, religious, studio session, film/OTT), genre incl. Bollywood, Sufi, Ghazal, Qawwali, Bhajan, Carnatic, Hindustani, Indie, Jazz, EDM, Hip-hop, Folk; budget band. Backend already stores `languages`, `genres`, `roles`; event type is derived from `open_to` + a new profile field `event_types` (jsonb) filled at join and in the profile.
6. **Copy rules** (applied by B6, enforced by review): one noun per concept — *musician* (public/musician side), *hirer* (public), *applicant* only inside the hirer's applicants view; *opportunity* as the umbrella noun with the kind shown on the card (gig, session, audition, tour, teaching, job); Indian date/time everywhere (`9 Oct, 6:30 pm`; `Tomorrow 6 pm`; no seconds, no US order) through one `formatWhen`; rupees as `₹5,000`, never `INR 5000`; no engineering words (server-enforced, synthetic, mock, environment, placeholder, demo data) outside the admin; every empty state and error says what to do next.
7. **Protection promise stated, truthfully**: "Deposits are held by Verse until the booking is done" only once payments are live; until then: "Free to post · No fee to musicians · Response promise within 2 hours (9 am–11 pm IST)" — the urgent promise already exists in `backend/config/urgent.yml`.

### 5.2 Screen-by-screen intent (what the eye should land on)

| Screen | First thing the eye lands on | Second | Everything else |
|---|---|---|---|
| Landing | hero photograph + "Hire a verified musician for your session or gig, within 24 hours" + two role buttons | six musician art-avatars/cards "Now on Verse in Mumbai" with play chips + from-₹ | how it works (3 icons), role tiles with photos, urgent CTA, city selector, protection line, footer |
| Directory | photo/art avatar + name + verified + from ₹ | play chip | chips: role, city, language, event type, verified |
| Public profile | avatar/photo, name, role · genres, city, verified, **from ₹** | play chips (3) + sticky Message / Request a quote (with the musician carried into the quote) | bio, rates table, credits, samples grid, reviews, "replies in ~N min" |
| Job page | cover art + title + company + pay | Apply (sticky) | facts grid, description, requirements, similar jobs |
| Musician dashboard | needs-you-now tiles | good fits (with cover art) | stats line; empty ⇒ one illustrated action |
| Hirer dashboard | new applicants (avatars) | live opportunities with cover art + counts | post / urgent choice cards when empty |
| Post opportunity | plan status line ("Free plan: 1 of 1 active — upgrade to post more") **above** a 3-step form | template chips | ≤ 5 fields per step |
| Urgent request | 5 fields (role, when, city, budget, note) | "More details" expander | the 2-hour promise |
| Admin | the queue that needs a decision | counts | grouped tabs Trust · Growth · Money · System |

---

## 6. The showcase: 150 demo accounts on production

**Purpose.** Make production look and behave like a live Mumbai marketplace on day one, honestly labelled, and removable with one click. **Composition:** 110 musicians + 40 hirers = 150 accounts, batch name `demo-showcase` (prefix `demo-` keeps every existing rule: public listing with the Demo chip, purge from Admin → Demo data). No known passwords (nobody logs into them; the owner uses their own account and the admin).

**Content rules (the seeder is rewritten to follow them; see B5):**
- Names: 300+ Indian first names × 120 surnames across regions (Marathi, Gujarati, Punjabi, Bengali, Tamil, Telugu, Kannada, Malayali, Goan Catholic, Parsi, Muslim, Sikh), no repeats within the batch; pronoun-neutral bios.
- Cities: Mumbai 60 %, then Pune, Navi Mumbai/Thane, Delhi, Bengaluru, Goa, Kolkata, Chennai, Hyderabad, Jaipur.
- Roles/genres drawn from `backend/config/search_taxonomy.yml` and `seo_pages.yml` so every hire page (12 roles × Mumbai) has ≥ 5 profiles and the directory chips all return results; languages and event types filled.
- Bios: 110 unique, 2–3 sentences, written in the person's voice (an agent writes them into `backend/config/demo/showcase_bios.yml` following a style card: concrete credits, instruments, years, a quirk; no superlatives, no "passionate"). Rates: realistic Mumbai bands per role (session ₹3,000–15,000, show ₹8,000–60,000, day ₹5,000–25,000), rounded to hundreds.
- **Work samples: only CC-BY audio from ccMixter** (`https://ccmixter.org/api/query?f=json&lic=by&tags=…` — verified reachable and streamable), 40 tracks curated by genre into `backend/config/demo/showcase_tracks.yml` with title, artist, licence URL, MP3 URL, duration and 64 waveform peaks (computed once offline with ffmpeg). Each musician gets 1–3 samples titled honestly, e.g. *"Studio playthrough — demo sample: 'Give it up' by Carosone (CC BY 3.0)"* with the credit in `credited_as`. YouTube links only where a genuine CC-BY performance video is curated (none required). Never real artists' commercial recordings.
- Verification: 30 % of demo musicians `verified: true` with an approved verification request whose note reads "Demo profile — illustrative"; 5 % Verified Pro. The Demo chip sits next to the badge everywhere.
- Hirers: 40 organisations (studios, wedding planners, event agencies, indie labels, colleges, corporate event teams, restaurants/venues, film/OTT production houses) with logos as `CoverArt` and company descriptions; Free plan only — **no subscriptions, no payments, no reports, no pending verification requests, no pending reviews**.
- Activity: 45 opportunities across kinds (unique titles and 60+-char descriptions from `showcase_jobs.yml`), 8 urgent requests (3 filled, with responses), 60 applications with varied cover notes, 25 conversations with 3–6 distinct messages, 12 acts with members and photos as art, 6 completed bookings with reviews (unique text), 40 Stage posts spread over the past 30 days with reactions and comments, availability windows, saved jobs, folders.
- **Visibility rule (one rule, applied everywhere):** demo accounts appear wherever a human browses (directory, search, hire and rates pages, book-music, Stage, popular searches) and **never** in SEO or metrics: excluded from the sitemap and share pages, from `/public/stats`, from the funnel, from lifecycle/digest emails, badges, system posts and review prompts. Hire/rates pages stay `noindex` until organic thresholds are met.
- **Purge:** `BatchCleanup` deletes every table that references a user (incl. the ten it misses today) plus system posts that name a demo user; the admin gets a per-batch "Delete" button and a "Showcase (150)" preset; the seed job is idempotent by batch name.
- **Seeding production:** Fable sets Railway's web `preDeployCommand` to `bin/rails db:prepare && bin/rails demo:showcase` (idempotent, no-op if the batch exists), merges, verifies the public directory, then resets the command to `bin/rails db:prepare`. Removal later: Admin → Demo data → Delete `demo-showcase`.

---

## 7. Execution: briefs

**Mechanics for every brief.** Base: `origin/production`. Integration branch: `claude/launch-2`. Each brief works in its own worktree and branch `claude/l2-<id>`, opens a PR **into `claude/launch-2`**, and owns the files listed under *Owns*; it may read anything and must not edit files owned by another brief (ask Fable, who resolves by editing the plan). Order and dependencies are in §7.11. Gates before every push: `npm run typecheck && npm run lint && npm run format:check && npm run build && npm run check:bundle && npm run check:split && npm run test:all && npm run test:unit -- --coverage`; backend: `bin/rails test` (the affected files at minimum; full suite before the PR), `bin/rails zeitwerk:check`, `brakeman`, api_matrix entries for new routes, and `db/schema.rb` regenerated the CI way after any migration (drop DB, delete schema, `db:create db:migrate`). Playwright mocked specs that reference changed text or selectors are updated, never deleted; the suite is run **serially per machine** under `flock /tmp/verse-playwright.lock` (ports 4173–4176 are shared). Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DKVZ7DtE1jj6YgPmVPkvpk`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session URL. Acceptance for UI briefs: fold screenshots at 1440×900 and 390×844 for every changed screen, attached to the PR, plus the §5 rules (one primary button, first-fold image, ≤ 60 words before content on app screens / ≤ 90 on public). The `scratchpad/uxaudit` measurement scripts are gone; the acceptance evidence is the screenshots plus the numbers each brief states.

### 7.1 B0 — Foundations and hygiene (first; small; one PR)

*Owns:* `backend/app/controllers/application_controller.rb` (public payload), `talent_controller.rb` (show visibility only), `sitemaps_controller.rb`, `share_pages_controller.rb` (filters only), `lifecycle_sequences.rb`, `notifier.rb`, `lifecycle_email_delivery_job.rb`, `events_controller.rb` + a migration adding an index, `backend/config/legal.yml` guards (`legal/policy` controller), `src/app/routes.tsx` (redirect rows only), `src/app/lib/analytics.ts` call sites in `Join.tsx`, `AuthPage.tsx`, `LandingHero.tsx`, `showcase/Library.tsx`, `.gitignore`, `vercel.json` (cache header for `/img/*` and `/`-level assets), `README.md` / `DEPLOYMENT.md` release-gate sections, code comments citing `VISION.md`.

1. T-01: `public_user`/`public_profile` build an explicit allow-list (id, name, headline, location, roles, genres, instruments, languages, skills, credits, rates, availability, verified, verifiedPro, responseTime, reviews summary, demo, createdAt) — nothing from `user.as_json`. Add a test asserting the seven leaked keys are absent on `/api/public/talent`, `/api/public/talent/:id`, `/api/candidates`, `/api/search`.
2. T-03: `public_show`, `candidates#show`, sitemap and share pages apply `SyntheticQa::Demo.publicly_listed` (hidden batches 404); sitemap and share pages additionally exclude **all** synthetic users (demo included) — §6 visibility rule.
3. J-10: `/signup` → `/join/musician`; `/join` → `/join/musician`; keep `/login` → `/auth/jobseeker`.
4. T-04: `legal/policy` returns `configured: false` per field while a value still matches `/^\[.*\]$/`; Privacy/Terms render the DPDP block and invoice fields only when configured, with a neutral "Contact details are published before launch" line otherwise. Admin Operations tab shows a red row "Legal details unfilled" listing the field names.
5. T-11: move `NotificationEmail.deliverable_to?` ahead of `LifecycleEmail.record!` in all sequences and milestones; a rake task `lifecycle:release_undelivered` deletes rows whose delivery never happened (log line `lifecycle_email_skipped` has the key).
6. T-12: fire `path_chosen` on the landing role buttons, `signup_started` on the first join step, `signup_completed` on account creation, `profile_link_added` when a link is saved from Library or join. Verify in the admin Funnel tab on the local stack.
7. T-13: migration adding an expression index on `((props->>'profileId'))` for `product_events` where `name = 'profile_view'`.
8. V-09: `.gitignore` `dist-*/`; delete `src/app/components/figma/ImageWithFallback.tsx`; `vercel.json` `Cache-Control: public, max-age=604800` for `/img/(.*)`, `favicon.ico`, `og-default.png`.
9. Q-05: README and DEPLOYMENT list the exact CI gate command set (§7 mechanics); TESTER.md audit line corrected. Replace `VISION.md` references with `docs/VERSE_PLAN.md`.
10. Hirer `/portfolio` 403: `portfolio_controller.rb` authenticates both roles as `portfolios_controller.rb` does.

### 7.2 B1 — Photo, art and media kit (before B2, B3, B5)

*Owns:* `src/app/components/kit/**` (new files + `UserAvatar.tsx`), new `src/app/components/media/{CoverArt,ArtAvatar,WaveformStrip,Photo}.tsx`, `public/img/**`, `docs/IMAGE_CREDITS.md`, `src/app/pages/public/CreditsPage.tsx` + its route row, backend migration + `profiles.photo_url`, `acts.photo_url`, `profiles.event_types`, upload wiring in `profile_controller.rb`/`acts_controller.rb`, `auth_connections` avatar copy in `google_sign_in.rb`, `post.rb#author_avatar`, `Navigation.tsx` avatar only, `AccountSettings.tsx` (photo section), `stage/PostCard.tsx` (avatar only).

1. `CoverArt({ seed, kind?, genres?, size, rounded })`: deterministic SVG (gradient pair from a 12-palette keyed by genre family, 3 layered blurred blobs, a waveform ribbon of 48 bars from the seed, an optional `FormatGlyph`), renders crisp at 48–640 px. `ArtAvatar({ id, name, size })`: circular CoverArt with a two-letter monogram at 30 % opacity. `UserAvatar` gains `photoUrl?` and `art?` props: photo → art (when `art` or the user is a demo account) → initials.
2. `WaveformStrip({ peaks: number[], playing?, progress? })` 64 bars; `PlayChip` shows it inline (height 16) when `media_metadata.waveform` exists.
3. `Photo({ src, alt, width, height, sizes, priority? })`: `<img>` with `loading="lazy"` (eager when `priority`), `decoding="async"`, explicit dimensions (no layout shift), `srcset` from the 800/1600 variants.
4. Photography set: fetch via the Commons API with a descriptive User-Agent (`VerseMarketplace/1.0 (+https://verse-music-platform.vercel.app)`), one request per second, `prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600`, filter `LicenseShortName` ∈ {CC0, Public domain, CC BY 2.0/3.0/4.0} first, CC BY-SA only if a subject has no other candidate; ≥ 1200 px wide, landscape; subjects: tabla, sitar, sarod/veena, Indian wedding band / baraat, playback studio vocalist, DJ at an Indian wedding, live sound desk, rehearsal room, drummer, guitarist, keyboard player, saxophonist, violinist, Carnatic concert, qawwali, folk (dhol), college fest stage, recording console, choir. Convert with sharp (`npx --yes sharp-cli`) to WebP q80 at 1600 and 800 widths; total set ≤ 4 MB. `docs/IMAGE_CREDITS.md` + `/credits` page list file, title, author, licence, source URL; footer links "Photo credits".
5. Migration: `profiles.photo_url:string`, `acts.photo_url:string`, `profiles.event_types:jsonb default []`. Upload: reuse the existing presigned/Active Storage path with `image/jpeg|png|webp` ≤ 5 MB; client crops square to 512 px (canvas) before upload; `PATCH /api/profile` accepts `photoUrl`; Settings gets a "Photo" section (upload, remove); Google connect copies `avatar_url` into `photo_url` when empty. Stage `author_avatar` returns `photo_url`. Public payload exposes `photoUrl` (B0's allow-list adds it).
6. Unify the three EmptyState implementations onto `kit/EmptyState` (help and admin call sites switched; admin keeps its density via a `compact` prop).

### 7.3 B2 — Cards, profile, ranking, filters (after B1)

*Owns:* `JobCard.tsx`, `components/talent/**`, `CandidateSearch.tsx`, `pages/public/PublicTalent.tsx`, `pages/public/PublicProfile.tsx`, `pages/public/PublicAct.tsx`, `pages/public/PublicActs.tsx`, `BookTalent.tsx` (quote entry only), `backend/app/controllers/talent_controller.rb` (ordering + filters), `search_controller.rb` (filters), `acts_controller.rb` (city filter), `src/app/lib/format.ts` (rate helpers), `src/app/lib/apiTypes.ts`.

1. `fromRate(profile)` = min of session/show/day/hourly rates; cards and hero show "from ₹5,000"; profile shows a rates table (Session · Show · Day · Tour day · Hourly, only filled rows).
2. Talent and directory cards: avatar (photo/art/initials), name, Verified/Verified Pro/Demo, role · genres (via `personLines`), city, **from ₹**, review avg + count when > 0, "N bookings" when > 0, "Replies in ~N min" when known, one `PlayChip` with waveform, ≤ 3 chips; act cards: `CoverArt`/photo, name, "from ₹", members, genres.
3. Ranking (T-02): `ORDER BY verified DESC, has_sample DESC, completeness DESC, has_rates DESC, last_active_at DESC` with `completeness` computed as in the dashboard (`profileScore`); expose `has_sample` via a subquery on `portfolio_items`.
4. Filters (§5.1.5): `language`, `eventType`, `genre`, `budgetMax` on `/api/public/talent`, `/api/candidates`, `/api/search`; chips on the directory and Find talent; `location` defaults to the hirer's city in Find talent and Book talent (J-24) with an "All cities" chip.
5. J-04: "Request a quote" from a profile opens the enquiry with the musician (or the act they front) pre-selected; J-17: no Message/Quote on one's own profile — show "Edit profile"; J-15: profiles and acts opened from a signed-in workspace render inside the workspace shell (role nav), using the same page component with a `shell` prop.
6. Job rows and job hero use `CoverArt`; `similar opportunities` (3) under the job page.

### 7.4 B3 — Landing, public pages, OG images (after B1)

*Owns:* `LandingPage.tsx`, `components/landing/**`, `src/app/lib/landing.ts`, `pages/public/{HirePage,RatesPage,LegalPage,SiteMapPage}.tsx`, `pages/{Pricing,Guide,NotFound,UrgentHire}.tsx`, `scripts/prerender-heads.mjs`, `index.html`, `vercel.json` (rewrites for `/api/og/*` only), new Vercel function `api/og.ts`, `share_pages_controller.rb` (image field only), `public/manifest.webmanifest`, touch icons.

1. Hero: full-bleed photograph (right two-fifths on desktop, background with gradient scrim on mobile), headline unchanged, subline shortened to one sentence, the two role buttons, the urgent link; below it the "Now on Verse in {city}" row becomes six cards (avatar, name, role, from ₹, play chip) — served from `/public/talent?location=…&limit=6` with the new ranking, so it is populated by the showcase.
2. Proof without invented numbers: replace the threshold-gated counters with a three-item promise strip — "Verified by the Verse team", "Reply within 2 hours, 9 am–11 pm IST", "Free to post · musicians never pay" — and show real counters only when organic thresholds are met (keep `landing.ts` thresholds; demo excluded).
3. Sections: how it works (three icons, ≤ 8 words each, photo strip beneath), "Find by role" tiles (12 SEO roles with photos → `/hire/:role/mumbai`), "Need someone by tomorrow" band with the urgent form's first two fields inline, city selector (Mumbai + "Delhi, Bengaluru, Pune, Goa coming"), Stage teaser (three recent public-safe system posts), footer with credits link.
4. Hire and rates pages: per-role header photo, listing cards from B2, FAQ collapsed; `noindex` only after the API says thresholds unmet (never before it answers) — prerender their heads for the 12 × 16 pairs via `prerender-heads.mjs` reading `seo_pages.yml`; `SiteMapPage` lists them.
5. OG images: `api/og.ts` on Vercel (Satori + `@vercel/og`) renders 1200×630 PNG for `?type=professional|opportunity|act&id=` from the public JSON (avatar/art, name, role, city, from ₹, Verified) and a default card; share pages set `og:image` to it; `index.html` gets document-level default og/twitter tags, `theme-color`, apple-touch-icon, manifest. Add a Googlebot rewrite for `/opportunities/:id` and `/professionals/:id` to the share pages so JobPosting/Person JSON-LD reaches Google.
6. `/urgent` uses `PublicNav`; `NotFound` uses the app palette and offers search + the three role links; Pricing hero pill removed (T-06 part), annual toggle hidden when `annualAvailable` is false.

### 7.5 B4 — Forms (independent of B1–B3)

*Owns:* `PostJob.tsx` and its step components, `components/templates/**`, `UrgentRequests.tsx`, `UrgentHire.tsx` (form body only; nav is B3's), `ProfileSetup.tsx`, `Join.tsx` + `components/join/**`, `CompanyProfile.tsx`, `PlanLimitDialog.tsx`/`PostJobPlanLimitDialog.tsx`, backend `jobs_controller.rb` (draft/limit endpoints), `urgent_requests_controller.rb` (create only).

1. Post opportunity → **3 steps**: *What & where* (title, kind, function, genre, location, workplace, posting-as), *Pay & dates* (pay min/max + period or "Not disclosed" with a warning that undisclosed pay gets fewer applicants, start date, deadline, duration, slots), *Screen & review* (description with template chips, requirements, screening questions, languages, review). ≤ 5 visible fields per step; optional fields under "More details".
2. J-01/J-13: `GET /api/jobs/limits` returns `{ activeAllowed, activeUsed, plan }`; the page shows the plan line above step 1 and disables "Publish" (not the whole form) with the upgrade link when the limit is reached; drafts save on every step change (existing draft endpoint) and are offered on reopen; city and posting-as prefilled from the company profile.
3. J-02: template chips fill an editable draft but leave `{{placeholders}}` highlighted and block submit while any remains (client) and refuse `{{` server-side.
4. J-05: editing pay on a live listing keeps it live (backend: pay fields do not reset moderation status); the wizard shows "Changes to title or description send the listing back to review" only for those fields.
5. Urgent request → 5 required fields (role, when, city, budget band, note) + "More details" (venue, end time, instrument, requirements); the same form component powers `/urgent` (public) and `/employer/urgent` (J-26); the 2-hour promise shown under the button; server validation aligned.
6. Profile setup → one page with anchored sections (About · Skills & genres · Rates & availability · Links · Verification), autosave per section with "Saved" state, unsaved-changes guard on navigation (J-18), URL fields normalised (`example.com` → `https://example.com`) before validation; verification request shows "Pending review" state.
7. Join (hiring) → 4 fields (organisation, city, what you hire for, email) + "More"; join (musician) step tabs get full labels; existing-email path says "Sign in instead".

### 7.6 B5 — Showcase demo data (independent; backend-heavy; Fable seeds production)

*Owns:* `backend/app/services/synthetic_qa/**`, `backend/config/demo/**` (new), `backend/lib/tasks/demo.rake` (new), `backend/app/jobs/demo_data_*_job.rb`, `backend/app/controllers/admin/demo_data_controller.rb`, `src/app/components/admin/DemoDataPanel.tsx`, exclusions in `weekly_digest_job.rb`, `lifecycle_sequences.rb` (scope only), `stage_system_posts_job.rb`, `fast_responder_week_job.rb`, `review_prompt_sweep_job.rb`, `funnel_queries.rb`, `seo/hire_stats.rb`, `seo/rates.rb`, `public_stats_controller.rb`, `hire_pages_controller.rb`.

1. Content packs (YAML under `backend/config/demo/`): `names.yml` (first/last by region), `bios.yml` (110), `companies.yml` (40 with descriptions), `jobs.yml` (45), `urgent.yml` (8), `messages.yml` (25 threads), `posts.yml` (40), `reviews.yml` (12), `tracks.yml` (40 ccMixter CC-BY tracks: title, artist, licence, MP3 URL, duration, 64 peaks). The agent curates tracks with `lic=by` only, verifies each MP3 streams (HTTP 206 `audio/mpeg`), computes peaks once with the Playwright ffmpeg (`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`) and commits the numbers, never the audio.
2. `SyntheticQa::Showcase` builds the batch per §6 (composition, verification share, art avatars — no photos, rates, languages, event types, availability, activity graph), deterministic from a seed so re-runs are identical; `Demo::SIZES` gains `showcase` (110/40); `MAX_USERS` 300 stays.
3. Purge completeness (T-08): `BatchCleanup` covers every table with a user FK (list them from `schema.rb`) and deletes system posts whose payload names a batch user; a test seeds a showcase batch, exercises Stage/badges/review prompts, purges, and asserts zero rows remain and no FK error.
4. Visibility rule (T-09): hire stats, rates, popular searches and public stats include demo users **for listings/counts shown to browsers** but public stats keep an `organic` variant used by the landing counters; digest, lifecycle, badges, system posts, review prompts and funnel queries exclude synthetic users; sitemap/share exclusion is B0's.
5. Admin Demo data tab: preset buttons (Showcase 150 · Small · Medium · Large), per-batch Delete with confirmation, progress, and "what is and is not included" copy.
6. `bin/rails demo:showcase` — idempotent (no-op when `demo-showcase` exists), safe in production (does not require `ALLOW_SYNTHETIC_QA`; requires the batch name to start with `demo-`), logs counts. Fable runs it on production through Railway's pre-deploy command and then resets the command.

### 7.7 B6 — Copy and formatting sweep (last, after B2–B5 merge)

*Owns:* every user-facing string in `src/app/**` not owned by an in-flight brief at the time it runs, `src/app/lib/format.ts` `formatWhen`/`formatMoney`, email templates in `backend/app/services/email_delivery.rb`, `notification_email.rb`, `lifecycle_sequences.rb` bodies, `backend/config/copy/**` if introduced.

1. Apply §5.1.6: nouns, dates (`formatWhen` everywhere a `Date` prints; no `toLocaleString()` defaults), rupees, engineering words removed (T-06), vague buttons renamed, every empty state and error states the next step, "a instrument" class grammar fixed, US timestamps gone (J-19).
2. Payment-unavailable states (J-06): "Payments open soon — we'll email you" with a notify-me toggle instead of raw errors; Billing hides "Start free trial" when `paymentsAvailable` is false and explains Early Access Pro instead.
3. Email templates: brand header (mark + name), one primary button, Indian dates, unsubscribe footer; lifecycle bodies proofread.
4. The copy lens findings (§4.6) are the checklist; each replacement string is applied verbatim unless it conflicts with §5.1.6.

### 7.8 B7 — Hirer flows (after B2)

*Owns:* `EmployerDashboard.tsx`, `OpportunityPipeline.tsx`, `EmployerApplications.tsx`, `CandidateCompare.tsx`, `Bookings.tsx` (hirer branch), `BookingDepositPanel.tsx`, `Billing.tsx` (availability messaging shared with B6 — B7 owns the page structure), `JobDetails.tsx` owner view, `Messages.tsx` (thread grouping), backend `urgent_request_responses` accept endpoint, `conversations_controller.rb` (find-or-create per pair), `booking_requests_controller.rb` (change-request message).

1. J-03: each urgent response gets "Message" (opens/creates the conversation) and "Accept" (marks the request filled by that musician, notifies both, posts nothing public); the musician who responds sees the conversation immediately.
2. J-11: urgent lists show only relevant items — hirers see their own requests plus a "Browse open requests" tab; musicians see matches for their roles/city first, paged 20 at a time.
3. J-12: after submit, a "What happens next" card (review within 24 h, then live; edit anytime) and the owner job page shows status, applicants count, Edit / Close / Share / Duplicate.
4. J-14: applicant cards link to the public profile (workspace shell), the empty state says "No applicants yet — most listings get their first within 48 hours; share it" with a Share button; Compare gets Message / Shortlist / Remove per column and de-duplicated chips.
5. J-19: conversations are one thread per hirer–musician pair, with the job context shown as a chip inside the thread; J-25: enquiry limit shown before the form; "Ask for changes" gets a message field; the policy block renders once.
6. J-16: hirer nav loses "Book & perform" musician tools (availability, acts as performer); Book talent stays.
7. J-26: the stale sign-in toast is cleared on route change; the empty dashboard shows the two choice cards once.

### 7.9 B8 — Musician flows (after B2)

*Owns:* `JobSeekerDashboard.tsx`, `ProductTour.tsx` (`TourStrip` state), `JobSearch.tsx` (defaults), `showcase/Library.tsx`, `components/join/WorkLinks.tsx`/`ProfileDraftReview.tsx` (import UX), `Portfolio.tsx` (delete) + its inbound links, `Navigation.tsx` (musician account menu grouping), `Billing.tsx` musician branch, `AccountSettings.tsx` (password section), `Reviews.tsx`, `StageFeed.tsx` (system-post density), `UrgentRequests.tsx` musician branch, backend `link_import` labelling, `urgent_matcher` role matching, `password` set endpoint.

1. J-09: `TourStrip` steps are ticked from real state (has sample, has availability, has applied) and the strip disappears when all are done.
2. J-07: "Add from a link" keeps the pasted link on Close (drafted item) and confirms on Add; profile-draft-from-links shows what was found per link and errors per link; Spotify artist/album/track labelled correctly.
3. J-20: Find work defaults to the musician's roles and city (chips pre-selected, removable); urgent matching compares normalised role tokens with word boundaries (Dholak ≠ Dhol) and instrument synonyms from the taxonomy.
4. J-16: musician account menu grouped (You · Perform & book · Hire someone · Settings) with ≤ 12 items; Billing for musicians shows "Free during beta" and nothing about hirer plans.
5. J-21: code-only accounts can set a first password from Settings (backend `POST /api/account/password` when none set); wrong-method sign-in says "This account uses email codes — send me a code".
6. J-22: delete `Portfolio.tsx` and repoint the tour, JobDetails and WelcomeNextStep to `/jobseeker/library`.
7. J-23: Stage feed collapses consecutive system posts into one "This week on Verse" card; "Employer reviews" page explains it fills after a completed booking; empty bookings CTA for musicians is "Set availability".
8. J-03 musician side: responding to an urgent request opens the conversation.

### 7.10 B9 — Quality infrastructure (parallel; small)

*Owns:* `playwright.config.ts`, `tests/e2e/qa-helpers.ts` fixtures, `tests/e2e/zz-*-shots.spec.ts`, `tests/frontend-*-smoke.mjs`, `.github/workflows/qa-agent.yml`.

1. Q-02: ports from `QA_PORT_BASE` (default 4173); document the serial rule and the `flock` convention in `docs/qa/TESTER.md`.
2. Q-01: populated fixtures (3 talent, 3 jobs, 3 acts with samples and rates) in `qa-helpers.ts` so the mocked axe sweep sees cards; an axe pass over the local seeded stack is part of the launch-2 acceptance.
3. Q-04: screenshot output dir from `SHOTS_DIR` env with a repo-relative default; smoke scripts assert behaviour via the built bundle or are moved into Vitest.
4. Q-03: nightly workflow gets a failure notification step (GitHub issue on failure) and the `live-synthetic` job posts a summary comment; document `QA_SMOKE_*` in the owner list.

### 7.11 Order, parallelism, review

```
B0 ──┐
B1 ──┼──▶ B2 ──▶ B7, B8 ──┐
     │       ▶ B3 ────────┤
B4 ──┤                    ├──▶ B6 ──▶ launch-2 → production → seed showcase → verify → handover
B5 ──┤                    │
B9 ──┘────────────────────┘
```

B0, B1, B4, B5, B9 start together (disjoint files). B2 and B3 start when B1 merges into `claude/launch-2`; B7 and B8 when B2 merges. B6 last. Every PR is reviewed by an independent reviewer agent against its brief and the §5 rules before Fable merges it into `claude/launch-2`; the integration branch runs the full CI via one PR to `production`. After merge: Vercel auto-deploys both sites; Railway deploys the API and worker; Fable seeds the showcase (§6), re-runs the ten-lens crawl on production data locally (a fresh local stack seeded with `demo:showcase`), fixes regressions, and updates §1.3 and §4.

---

## 8. Owner actions (exact names; never paste values into chat or code)

| # | Where | What | Why |
|---|---|---|---|
| 1 | Railway → `verse-music-platform` → Variables | `ADMIN_PASSWORD` ≥ 14 characters (the worker's value is already 24; make them identical) | `/api/readiness` is 503 only because of this |
| 2 | Railway (both services) | `RAZORPAY_ALLOW_TEST_MODE=true` for the rehearsal **or** live keys `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, plans `RAZORPAY_PLAN_PRO`, `RAZORPAY_PLAN_STUDIO`, `RAZORPAY_PLAN_PRO_ANNUAL`, `RAZORPAY_PLAN_STUDIO_ANNUAL`, `RAZORPAY_REFERRAL_OFFER_ID` | checkout is refused today; annual and referral discounts need their ids |
| 3 | Railway (both) | `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) | AI assist is off |
| 4 | Railway (both) | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY`, `_DETERMINISTIC_KEY`, `_KEY_DERIVATION_SALT` (each `${{ secret(32) }}`) | Google sign-in and connected accounts |
| 5 | Railway (both) | `YOUTUBE_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | richer link import |
| 6 | Railway (both) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_URGENT`, `WHATSAPP_ENABLED=true` | urgent alerts on WhatsApp |
| 7 | Repo `backend/config/legal.yml` (a PR from the owner or values sent privately) | legal name, address, state, GSTIN (blank until real), grievance officer name/email/address | Privacy/Terms placeholders |
| 8 | GitHub secrets | `QA_SMOKE_EMAIL`, `QA_SMOKE_PASSWORD` for a dedicated musician account | signed-in nightly smoke |
| 9 | Brevo | paid plan before ~1,000 members (weekly digest volume) | deliverability |
| 10 | Domain | buy `versemusic.in` (+ `verse.music`, `verse.co` as redirects); set `FRONTEND_URL`, `VITE_PUBLIC_URL`, Vercel domains, Search Console token `VITE_GOOGLE_SITE_VERIFICATION`; submit the sitemap | launch domain and indexing |
| 11 | Admin → Demo data | when the showcase should go: click Delete on `demo-showcase` | removal |

---

## 9. After launch-2: rules and roadmap

- **Day-30 rule:** ≥ 20 urgent fills and ≥ 5 deposits paid ⇒ open Delhi and Bengaluru; otherwise stay in Mumbai, fix the funnel, add no features.
- **Monetisation gates:** ₹499 single post at day 30 if Pro conversion < 5 %; musician Pro (₹149–299) only at ≥ 70 % fill rate; booking fee 5–10 % only on completed live bookings > ₹50k; never sell musician visibility before delivering gigs.
- **Weekly loop (owner + admin):** Monday pinned Stage thread, Tuesday digest, Friday fastest-responders post, a meetup a fortnight, badge-share nudge on every verification, review ask on every fill. Scorecard: sign-ups by source, % publishing within 24 h, verified count and median time, urgent fills within 24 h (target ≥ 70 %), median first response, digest open rate, active commenters, badge shares, reviews per fill.
- **Deferred, in order:** light mode; Instagram embeds (CSP + Meta review); YouTube channel and Spotify imports; WhatsApp OTP; admin merge tool; resumes/career record; Enterprise plan; native apps (not planned).
- **Scale triggers:** search index audit at 20,000 members; second verification reviewer past ~150/week; two Puma processes + 2 GB at ~5 lakh members.
- **Ambition check (kept from the 10-lakh assessment):** 10 lakh *users* in six months is not realistic for a professional marketplace; 25–50k professionals + 3–5k hirers with 10 lakh reach is the honest target, and the loops above are how it is earned.

---

## 10. Appendix

**Taxonomy.** Function areas: Performance · Composition & Songwriting · Music Production · Recording & Studio · Live Sound & Audio · Stage & Technical · Tour & Production Management · Lighting & Video · A&R & Label · Artist Management · Booking & Events · Publishing / Rights / Royalties · Marketing / PR / Content · Music Education · Music Tech (`backend/config/search_taxonomy.yml`). SEO roles: drummer, guitarist, bassist, keyboard-player, singer, tabla-player, dhol-player, violinist, saxophonist, dj, sound-engineer, music-producer; cities: mumbai, delhi, gurgaon, noida, bengaluru, pune, hyderabad, chennai, kolkata, goa, ahmedabad, jaipur, chandigarh, kochi, lucknow, indore (`backend/config/seo_pages.yml`).

**Fixed configuration worth knowing.** Plans (`billing_controller.rb`): Free 1 post/1 seat/20 shortlist/2 bookings; Pro 10/2/250/20; Studio 50/8/2,000/100. Urgent (`urgent.yml`): promise "within 2 hours, 9 am–11 pm IST", expire 48 h, warn 6 h before. Verification (`verification.yml`): auto-approve ≥ 75 with identity ≥ 15, audit 10 %, Verified Pro = 3 completed + 1 review. Crons (`good_job.rb`): lifecycle hourly, digest Tue 09:30 IST, urgent sweep every 30 min, deadline sweep hourly, system posts hourly, review prompts hourly, fast responder Sunday 18:50 UTC, billing reminders 09:30 IST. AI launch mode: profile_headline, profile_bio, job_description, job_screening_questions; ₹1,500/month hard cap.

**Local production-mode stack.** `scratchpad/ux/stack.sh` (session scratchpad, not in the repo): Postgres on 5433 (`/var/lib/postgresql/pg5433`), API :3300, web :4600, admin :4610, email sink :4700; seeded with `SyntheticQa::BatchSeeder` batch `demo-ux1000` (700/300, password `UxAuditPass123!`, emails `qa+demo-ux1000-professional-0001@example.invalid` …). After B5 the reference seed becomes `bin/rails demo:showcase`.

**Verification gates (CI).** Frontend: typecheck, eslint 0 warnings, prettier, build (+ prerender), bundle budget (entry 11,000 / initial JS 106,000 / largest chunk 80,000 / CSS 30,000 gzip), site split, smoke scripts, Vitest 95/95/95/90 on `src/app/lib`, mocked Playwright (53 specs), npm audit high. Backend: Rails tests with SimpleCov 94/78, zeitwerk, brakeman, bundler-audit, schema drift, api_matrix. Production push triggers the same plus the QA agent; Railway deploys only after CI passes.
