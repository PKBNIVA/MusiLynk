# Verse — Launch readiness and release plan
_Prepared 2026-09-29 for the launch. Decisions here are final; anything marked "owner" needs you. **Build state (18:36 IST): everything below is merged to `production`** — SEO pack (#107), launch fixes (#109, #114), Early Access Pro + reminder emails (#111), hire/rates pages (#110), marketplace mechanics (#115), e2e spec fix (#118), integration of lifecycle/digest emails, Google sign-in, link import and the community Stage (#119), promo/referral/trial codes + annual plans (#120), verification automation (#121). API live on Railway; public site deploys 22:25 IST._

## 1. The one-line strategy

**"Find a verified musician for your session or gig within 24 hours." Mumbai first. Free for musicians during the beta. Hirers pay a flat monthly fee; no per-lead charges, no silent renewals, and any future booking fee is charged only on completed bookings.**

Why this and not "a LinkedIn for music": every research source describes the same three pains in India's informal market (WhatsApp/Instagram DMs, Facebook groups): no way to verify credentials, unclear pricing, and late or missing payment. Verse's verification badge, urgent matching and deposit-first booking map one-to-one onto those pains. Nothing else we built matters until a hirer gets a verified musician fast, once.

## 2. What the market told me (checked at the source; confidence stated)

### Foreign platforms — verified on their own pricing/help pages
| Platform | Who pays, how much | What to copy / avoid |
|---|---|---|
| GigSalad (US events) | Performers: free, or Pro $139/3 mo–$359/yr, Featured $169–$479; 5% per booking (2.5% on paid tiers); clients pay 10–12% | Two-sided fee on completed bookings works at scale; discounts only on the first payment, auto-renews (complained about) |
| The Bash (US events) | Vendors $129–$219/yr; 5% booking fee, $20 min, refunded if the client cancels; Booking Guarantee for clients | Fee only on outcome and refunded on cancellation — the fairest fee design found |
| SoundBetter (studio hire, Spotify) | Providers 5% + 3% processing; Premium $59/mo for full job-board access and ranking | Paid visibility on top of commission draws "pay to play" grumbles but the business held |
| AirGigs (session work) | Sellers 10–15%, $8 min, $20 activation; no monthly fee | Commission-only on sellers, small and stable |
| Encore (UK live, acquired by Mixcloud 2024) | Musicians 20% only when booked, folded into the quote; 25% deposit, non-refundable; artist no-show → deposit refunded to client | One number, charged on outcome, invisible to the hirer; deposit as the trust anchor |
| Alive Network (UK agency, 6,500 acts since 1999) | ~20% commission on top of the act's price; deposit = the commission; a coordinator per booking | The human "coordinator" is what hirers pay for — our admin hand-match is the same thing |
| Last Minute Musicians (UK directory since 2003) | Acts <£2/week, no commission, no auto-renewal | Cheap supply-side membership with no lock-in survives 20+ years |
| Gigmit (EU) | Artists €228/yr billed annually | Annual lock-in is its top complaint |
| Vampr (networking) | Pro $4.99/mo | Freemium networking monetises weakly |
| Musiversal / Sessions Boutique (remote sessions) | Hirer pays $249 / $248 per month for unlimited sessions from a curated roster | Hirer-pays subscription exists only where the platform runs the session itself — not our Pro |
| Thumbtack / Bark | Pros pay per lead ($10–40+ for musicians/DJs), charged even when the client never replies | The most hated pattern found. Never charge per lead |
| Fiverr | Sellers flat 20%; buyers 5.5% + $2.50 small-order fee | Two-sided commission at global scale; fits fixed-price gigs, not custom live work |

**What this corrects in my earlier view:** in every mature market the *musician* pays, because the platform delivers gigs. "Musicians never pay" is therefore a beta-phase choice for a thin, cold market — not a principle. A small booking fee is also fine when it is charged only on completed bookings and refunded on cancellation. What fails is being charged regardless of outcome (per-lead, non-refundable listings) and silent renewals.

### India — verified
| Fact | Source | What it means |
|---|---|---|
| Naukri: ₹400–₹1,650 per posting; 30-day SMB pack ₹2,500 for 2 posts; Internshala ₹2,999 per listing; Apna ₹1,949/mo for 3 credits; Foundit ₹1,000 per post | pricing pages / guides | Mumbai SMB hirers already pay ~₹2,000–3,000/month to post. Pro ₹2,499 sits on the anchor. **Confidence in the price point: medium** — anchor right, willingness to pay for a new brand unproven |
| Mumbai session musicians ₹3,000–₹10,000/day; wedding bands ₹50k–₹4.5L+ (WedMeGood Mumbai), singers ₹15–20k | studio guides, WedMeGood | Session tickets too small for a fee to matter; live acts are where a fee could live later |
| WedMeGood charges entertainment vendors ₹50,000–₹85,000 for non-refundable listings; vendors report near-zero conversions | Weddingkart review | Bands *will* pay for placement once we have hirer traffic; never sell it non-refundable |
| StarClinch revenue ₹2.4 Cr FY25 (−10%), no funding since 2021 | Inc42/Tracxn | The online "book an act" category is small and stagnant; don't compete on it |
| MusicLinkd: verification, credits ledger, studio booking, gear marketplace, escrow; Android early access only | musiclinkd.com | Only direct threat; broad and app-only. We win narrow, web-first, live now. **Confidence: medium** (their traction is unknown) |
| Musicians report fees "delayed, partially paid, or not paid"; 1,800 Karnataka artists unpaid; EY: 35% reinvest over half their earnings | The Indian Music Diaries 2025 | "Deposit before the gig" is a real musician hook (we have 50% Razorpay deposits) |

### Cold-start evidence (secondary sources, consistent across GigSalad, Airbnb, Thumbtack)
Seed supply from an existing roster; recruit demand city by city; run matching by hand until ~100 pairs. **Confidence: high** as a pattern, untested for Verse.

## 2b. What users actually praise and hate — from the reviews themselves

Read directly: Trustpilot pages for SoundBetter (4.5★, 519), GigSalad (4.8★, 5,742), Encore (3.8★, 438), Gigmit (2.9★, 581), StarNow (1.2★, 456), StarClinch (1.8★, 25), Musiversal; Thumbtack's own pro community; AirGigs on PissedConsumer; a musician's Vampr field report. Client reviews dominate the high scores; musician reviews carry the complaints.

| Pattern | Evidence | What Verse does about it |
|---|---|---|
| **Money held until delivery is the most-praised feature anywhere** | SoundBetter: "escrow… lock the funds until the final stems hit my folder gave me massive peace of mind"; GigSalad clients praise secure payment | Deposit on every quote is already built. Make it the headline for both sides; add "deposit held by Verse, released after the gig" wording. Week 1 copy |
| **Hirers love one request → many fast quotes** | GigSalad: "quotes within 1/2 hour… eliminated a huge amount of leg work" | Urgent request already fans out to 15. Extend the same "one request, several replies" to normal bookings (ask 3 acts at once). Week 2–4 |
| **Musicians hate blanket leads and speed races** | GigSalad performers: "blanketed leads that go out to thousands… don't fit"; Encore musicians: "it's about speed, not suitability", "posts close within 20–60 minutes", "not a single booking in 12 months" | Match on fit + availability + recency, cap notifications at 15, never a first-come lock. Show musicians why they were matched. Already the matcher's design; add the "why" line. Week 1 |
| **Ghosting by hirers is the top musician pain** | Encore: "customers go silent after requesting quotes"; Thumbtack: "75% of clients won't respond" and pros are still charged | Free for musicians (no charge to be ghosted); hirer must mark a request filled/closed or it auto-expires with a notice to everyone who replied. Week 1 (backend timer + email) |
| **Paying for visibility with no gigs = "scam" reviews** | StarClinch artists: "not a single gig… avoiding all calls"; Gigmit: "selling dreams", €200–300/yr; StarNow: "why should I pay if it's not certain I get the role" | Never sell musicians visibility before we deliver gigs. A musician tier only after ≥70% urgent fill-rate (§4) |
| **Silent renewals and "can't cancel" destroy trust** | Gigmit: "emails asking to pay €200+ for a subscription cancelled 3 years ago"; StarNow: "they keep taking my money"; GigSalad: discount only on first payment, auto-renews | Trial/renewal reminder emails + one-click cancel (§4 item 2) |
| **Fake or inflated profiles kill a network** | Vampr: users "posing as professionals with legitimate studios"; paid verification "never appeared on my profile" | Verification stays human-reviewed and free; show *what* was verified (ID? credits? both) on the badge. Week 2 |
| **Stale listings and broken filters are noticed immediately** | StarNow: "jobs still open when closing dates were weeks ago", "filters don't work" | Auto-close jobs at their closing date; nightly job that hides listings from inactive hirers; filter tests exist — keep them |
| **Musician no-shows are the hirer's nightmare** | Encore: band cancelled a wedding a month out; The Bash/Encore built replacement guarantees | Urgent replacement is our product; cancellation terms already in `bookings.yml`; add "replacement help" promise to booking confirmations. Week 2 |
| **Mismatch refunds** | Thumbtack: charged for a lead "that didn't match my hourly rate" | If we ever charge hirers per outcome, refund on cancellation (The Bash) |
| **Curated quality beats volume for paying hirers** | Musiversal (4.x★): "musicians are the real deal… Grammy pedigrees" — complaints only about wait times | Keep the pool verified and small at first; publish response-time stats, not headcounts |

## 2c. Getting musicians to list — the plan

The product truth from every review: musicians join for gigs, not for profiles. So the pitch is "get matched to paid work in Mumbai within 24 hours, free", and the ask must be near zero effort.

1. **Zero-effort listing: paste one link, get a profile.** Today the sign-up takes roles, city, years and up to a few YouTube/SoundCloud links (oEmbed) and builds a starter portfolio. Extend it to "paste anything" and let Verse write the profile (§2d). Target: a publishable profile from one Instagram/YouTube/Spotify/Linktree link in under 60 seconds, with the musician only correcting.
2. **Build it for them, they claim it (beta, by hand).** A musician sends a link on WhatsApp; you create a draft from admin ("Create draft profile from links"), Verse drafts it, they get a claim link, set a password, review, publish. Only for people who asked — no unsolicited scraped profiles (DPDP Act, and it reads as spam).
3. **Reasons to list, stated in their words:** free, always; verified badge reviewed by a human within 24 h; deposit held before the gig; matched on fit, not speed; you see why you were matched; hirers must answer or the request expires; no pay-to-play.
4. **Channels (Mumbai):** musician WhatsApp groups (Kasa Kai open-mic community and similar), music institutes and their meetups (Mumbai Music Institute, True School, SAE), studio rosters, wedding-band leaders (each brings 6–12 players), Instagram reels of real urgent fills ("booked a keys player in 3 hours"). Referral: each verified musician can vouch for 3 — vouched people get reviewed first (no cash referrals).
5. **Keep them:** weekly "requests near you" digest, profile-view counts, one-tap availability updates, a "Refresh from my links" button that pulls new work in.
6. **Measure:** link → draft → claimed → published → verified (rates at each step); time to publish; % of profiles with ≥3 work items; weekly active musicians answering requests.

## 2d. "Paste anything" import — design (spec to the letter follows in the roadmap; not tonight)

**Inputs accepted:** YouTube video/channel/@handle; SoundCloud track/profile; Spotify artist/track; Instagram post/reel/profile; Linktree (and similar link-in-bio pages); Bandcamp; Apple Music; JioSaavn/Gaana artist pages; WedMeGood/StarClinch/JustDial vendor pages; a personal website; LinkedIn (link only — it blocks fetchers).

**Fetch layer (no scraping of logged-in content, only what the page shows any visitor):**
- Keep keyless oEmbed for YouTube videos and SoundCloud (exists).
- Spotify Web API with client credentials (free): artist → name, image, genres, top tracks, follower count. Owner creates a Spotify developer app; two Railway secrets `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`.
- YouTube Data API v3 (free quota): channel/@handle → title, description, avatar, 10 latest videos. Railway secret `YOUTUBE_API_KEY`.
- Linktree and link-in-bio pages: fetch the public page, extract outbound links, preview each (depth 1, max 15 links).
- Generic pages (Bandcamp, vendor directories, personal sites): read Open Graph/Twitter/`<title>`/meta description only, through an SSRF-safe fetcher (DNS resolved and checked against private/loopback/link-local ranges before connecting, redirects re-checked, 1 MB and 5 s caps, HTML only). Start with an allowlist of hosts; open to any https host after a security review.
- Instagram: no API access without Meta app review; keep "link + caption typed by the user" and read the public OG title where available.

**Conversion into Verse's language, two passes:**
1. Deterministic: roles from `search_taxonomy.yml` terms found in titles/descriptions; instruments/genres from Spotify genres and keywords; city from text; years from "since 20xx"; credits from "played with / recorded for" phrases.
2. AI (Haiku, one call per import, new free task `profile_from_links` with its own monthly budget line of ₹1,000 and a deterministic-only fallback when the cap is hit): writes headline (≤80 chars), bio (≤600 chars), roles (taxonomy only), genres, and a caption per work item. Hard rule in the prompt and in code: **every claim must be traceable to a fetched source; nothing in the sources → leave empty.** Each generated field stores `source_url`. Cost ≈ ₹0.6–1 per profile.

**The user experience:** one review screen — "We drafted this from your links. Fix anything wrong." Every field editable, a source chip on each, nothing published until Save. Later, "Refresh from links" proposes patches through the existing review inbox (`showcase_suggestions`), so new work on YouTube or Spotify flows into existing portfolios without re-entry — the "one library, many views" principle already in the product.

**Sequence:** week 1 = Linktree + Spotify + YouTube channels + review screen (covers most Mumbai musicians' link-in-bio); week 2 = generic OG fetcher with allowlist + admin "draft for them" + claim flow; week 3 = refresh/patch loop.

## 3. Features: what matters, what ships tonight, what stays dark

### Ships tonight (built, verified today on the production-mode copy)
1. **Landing → two-minute sign-up** for musicians (`/join/musician`) and hirers (`/join/hiring`), starter portfolio from pasted links.
2. **Verification**: request with evidence → admin approves → badge on profile and public pages; hirers can filter for verified.
3. **Public discovery**: `/music-jobs`, `/music-professionals`, `/book-music`, entity pages, `/p/:slug` portfolios.
4. **Jobs**: post (Free = 1 active), apply, applicant pipeline, status changes with email.
5. **Urgent hire** `/urgent`: public form → account → matcher notifies up to 15 recent-active musicians (email; WhatsApp when you configure it) → admin hand-match tab → "within 2 hours, 9am–11pm IST" promise.
6. **Booking**: enquiry → quote (50% deposit default) → accept → Razorpay deposit; cancellation rules from `bookings.yml`; invoices.
7. **Messaging, notifications, account/data controls, reviews.**
8. **Billing**: Free / Pro ₹2,499 / Studio ₹5,999, 14-day server-enforced trial, Razorpay.
9. **Free AI help** (4 tasks, Haiku, hard cap ₹1,500/month, no "credits" wording).
10. **Admin**: verification queue, urgent tab, funnel tab, moderation, billing guardian.
11. **SEO pack** (PR tonight, see §6).

### Dark at launch (built, behind switches — do not turn on)
- **The Stage** (feed) — a feed with 50 users is a ghost town and it dilutes the wedge. Turn on when ≥200 verified Mumbai musicians.
- **Career record & resumes** — the portfolio already carries the hiring story; resumes add a second concept for users to learn.
- **Paid AI, AI credits, top-ups** — cost and margin don't work yet.
- **Booking platform fee** — stays 0% until liquidity.
- **Enterprise plan** — sales-assisted only.

### Not built, decided
- Native apps (MusicLinkd's choice). Web + WhatsApp is faster to iterate and where our users already are.

## 4. Subscriptions: verdict and changes

**Verdict: keep Free / Pro ₹2,499 / Studio ₹5,999 for launch; do not change prices before 30 days of data.** Confidence: medium. The Naukri/Apna anchor supports the price; what is unproven is paying a new brand for a pool of a few hundred musicians — so the Early Access period below is a requirement, not a perk.

**Week-1 changes (none tonight):**
1. **Early Access Pro** — Pro free for 90 days, no card, for the first 50 hirers you approve from admin. Mechanism: `config/billing.yml` (`founding: {enabled, seats: 50, days: 90}`), admin action "Grant founding Pro", `subscription.status = "early_access"` treated as Pro by `Entitlements`, "Early Access Pro" badge. No public code, no self-serve.
2. **Trial-ending and renewal emails** — 3 days before trial end and before each renewal, one-click cancel. No such email exists today; silent renewal is the top complaint at GigSalad, Gigmit, The Bash and BandMix. State the promise on `/pricing`.
3. **Remove `aiCredits` from the plans API payload** — unused, contradicts "no credits wording".
4. **Pricing-page copy** (paste as written): "One flat fee. No commission on your bookings. A ₹5 lakh wedding band booked through a commission agency costs ₹75,000–₹1,00,000 in fees; on Verse it costs your monthly plan." and "Cancel any time. We email you three days before your trial ends and before every renewal."

**Roadmap experiments (evidence from §2), in order of when the data allows them:**
- Day 30: ₹499 single post (Naukri-style) if <5% of active hirers convert to Pro.
- Day 60: **musician Pro at ₹149–299/month** (priority in urgent alerts, featured placement, extra portfolios) — only if ≥70% of urgent requests are being filled; every mature platform monetises supply once it delivers gigs.
- Day 60+: **booking fee on live acts** — 5–10% on completed bookings above ₹50,000, folded into the quote, refunded on cancellation (The Bash / Encore design). Never per lead, never on sessions.
- Later: paid "Featured act" placement for wedding bands, monthly and cancellable — never annual non-refundable (WedMeGood's failure).
- Content: a public "Mumbai session rates by role" page (GigXchange/MU pattern) — trust and SEO in one.

## 5. Go-to-market: the first 30 days (owner-led, product supports)

**Week 0 (this week)** — Deploy tonight. Seed supply by hand: 50–100 Mumbai musicians from your network across drums, keys, bass, guitar, vocals, sound/light crew; you verify each within 24 h. Create 10 acts. No public announcement yet.
**Week 1** — Bring 10–20 hirers on founding terms: 3–5 recording studios, 5 wedding-band leaders/managers, 3–5 event and corporate-event companies, 2 music schools. Post their real openings. Turn on WhatsApp alerts. Concierge every urgent request yourself from the admin Urgent tab.
**Week 2–4** — Announce in Mumbai musician WhatsApp/Facebook groups and Instagram with one message: "Verified profile. Deposit before the gig. Matched within 24 hours." Ask every filled urgent request for a review.

**Weekly scorecard (from the admin Funnel tab):** verified musicians; hirers with ≥1 post; urgent requests filled within 24 h (target ≥70%); median time to first response; enquiries → quotes → deposits paid; sign-up completion rate per audience.

**Kill/continue rule at day 30:** ≥20 urgent requests filled and ≥5 deposits paid → expand to Delhi/Bengaluru and open The Stage. Otherwise, stay in Mumbai and fix the funnel; do not add features.

## 6. SEO: what was wrong, what ships tonight, what waits

**Found:** SPA with no server rendering; static sitemap of 11 URLs (no job, profile, act or portfolio URLs); title/description set client-side only; no canonical, Open Graph, Twitter or JSON-LD; `/search` and auth pages indexable; site lives on `verse-music-platform.vercel.app`.

**What actually matters for this launch, in order:** (1) link previews — musicians and hirers will share job, profile and portfolio links on WhatsApp, and WhatsApp/Facebook/LinkedIn crawlers do not run JavaScript, so today every shared link shows the generic site card; (2) Google Jobs — `JobPosting` structured data gets "drummer job Mumbai" queries into Google's jobs box; (3) a real sitemap so every published job and verified profile is discoverable; (4) a domain.

**Shipping tonight (PR "SEO"):** dynamic `/sitemap.xml` from Rails (static pages + published jobs + public profiles + active acts + public portfolios, cached 1 h); `/share/...` HTML pages served to social crawlers via user-agent–conditional Vercel rewrites (Googlebot deliberately excluded — it renders the SPA); canonical/OG/Twitter/JSON-LD (JobPosting, Person, MusicGroup, ProfilePage) in `usePageMeta`; noindex on auth, search and authenticated pages; build-time head prerender for the 15 static routes; `robots.txt` tightened; default 1200×630 OG image; Google Search Console meta hook (`VITE_GOOGLE_SITE_VERIFICATION`).

**Waits:** role × city landing pages (`/hire/drummer/mumbai`) — high value for the wedge but they need real copy and ≥10 profiles per page or Google treats them as thin; week 2. Full prerendering/SSR — not needed; Google renders the SPA, and the bundle budget keeps it fast.

**Owner actions:** buy a domain (e.g. a `.in`/`.co.in`), add it in Vercel, then set `FRONTEND_URL` (Railway) and `VITE_PUBLIC_URL` (Vercel) to it — the PR body carries the checklist of every place the origin appears; create a Google Search Console property and put its token in Vercel as `VITE_GOOGLE_SITE_VERIFICATION`; submit the sitemap.

## 7. Verification results and tonight's fix wave

**Pass 1 (real stack, production build 3ea60bd, desktop):** musician sign-up → verification → admin approval → badge on own and public profile: pass. Hirer sign-up → post job: pass (job correctly waits for admin approval). Public pages: all 200, under 1 s. Billing page: trial shown, cancellation visible, no "credits" wording. Stage and resumes: dark (404). Not reached in pass 1: booking, messaging, account deletion, mobile — pass 2 is running them now, plus the hiring loop after admin approval, the plan-limit gate and the urgent flow end to end.

**Triage of the 12 reported items (my decisions, facts checked in code):**

| Item | Decision | Why |
|---|---|---|
| V-01 `/employer/organization` 404 | Not a defect | Not a route; nothing links to it (the page is `/employer/workspace`) |
| V-02 Location field drops typed text unless Enter is pressed | **Fix tonight** | A hirer who types the city and clicks Next is stuck with a silent error |
| V-03 AI button hidden while AI is off | Intended | A visible "unavailable" button is worse; appears once `ANTHROPIC_API_KEY` is set |
| V-04/V-05 new job not public until approved | Intended | "We check every listing" is the trust promise. Beta rule: **approve within 2 hours, 9am–11pm IST** |
| V-06 test script mis-parsed the verification email | Tooling | The email and link were correct |
| V-07 identical raw-HTML title on every route; V-09 sitemap has 11 URLs | **SEO PR tonight** | Head prerender + dynamic sitemap + share pages (§6) |
| V-08 role links not found by the script | Re-check in pass 2 | Likely a selector mismatch |
| V-10 second-job plan limit not shown | Re-test in pass 2 | The first job was still pending, so no *active* job existed |
| V-11 verification dialog has no note field | **Fix tonight** | The admin already reads a note; musicians can't write one |
| V-12 no link from your profile to your public page | **Fix tonight** | Small, and it is how people share themselves |
| `ERR_CERT_AUTHORITY_INVALID` on link previews | Sandbox artefact | The container's proxy CA; pass 2 re-checks with the CA set |

**Tonight's fix wave (one PR, fully specified, Sonnet executing):** V-02 blur-commit, V-11 optional note (≤2,000 chars), V-12 "View public profile" link, drop `aiCredits` from the plans payload, the two pricing-copy lines from §4. Nothing else — the release stays small.

**Pass 2 (real stack, after admin approval):** hiring loop pass end to end (approve → public → apply → two status changes → notification + email → 3+3 messages with unread badges); booking pass (enquiry → quote → accept, "deposit due" both sides, no placeholder text); account pass (password change, email-change request, data export file, deletion → public profile 404, sign-in fails); entity pages 200 with correct titles; landing role links work (V-08 closed). Not run live: urgent signed-out flow (behaviour confirmed from code and covered by the CI spec) and the mobile repeats (covered by the chromium-mobile CI project). New items and decisions:

| Item | Decision | Why |
|---|---|---|
| V-13 signed-in user opening a public page by full load sees the signed-out header | **Fix tonight (PR "launch fixes 2")** | Shared links and new tabs are how people arrive; the session must hydrate at boot everywhere |
| V-14 second listing on Free: the 402 is handled with a toast that vanishes on redirect | **Fix tonight** | A toast is not an upgrade path — blocking dialog with See plans / Close another listing / Keep as draft |
| V-16 `/music-jobs` buries new listings under older ones | **Fix tonight** | Newest first when there is no search query; relevance when there is |
| V-02 first fix inserted a chip row and shifted "Next" under the pointer | Sent back | Single-value fields now show the value inside the input; no height change |
| Link previews through the sandbox proxy | Sandbox artefact | The API fetches real YouTube/SoundCloud titles; the browser-side image error is the container's CA |


## 8. Release plan for tonight

| Time (UTC / IST) | Step | Who |
|---|---|---|
| now–07:00 / 12:30 | Real-stack verification of 9 flows; SEO PR opened | agents (execution) |
| 07:00–08:00 / 13:30 | Triage defects; fix-wave spec written to the letter | me |
| 08:00–11:00 / 16:30 | Fix wave implemented, gates green, PRs merged to `production`; Railway deploys API + worker automatically after CI | Sonnet, then me to merge |
| 11:00–12:00 / 17:30 | Post-merge check on production API: `/up`, `/api/ai/status`, `/api/public/stats`, `/sitemap.xml`, a `/share/...` URL | me |
| 16:48–17:00 / 22:18 | Vercel daily deployment quota resets; deploy public site from `production` (reminder set 16:55); confirm `verse-release` meta = production SHA; smoke the landing, `/join/*`, `/urgent`, a job page | me |
| after | Owner: domain, Search Console, WhatsApp variables, `legal.yml`, `bookings.yml` | owner |

**Rollback:** Vercel — promote the previous deployment (one click); Railway — redeploy the previous image from the service's deployments list; no migrations tonight require data changes, so rollback is safe.

## 9. Owner checklist (no deadline, but before public announcement)
- `backend/config/legal.yml`: legal name, GSTIN, address, grievance officer (required under IT Rules 2021 for an intermediary).
- WhatsApp: Meta Business → the four Railway variables (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_URGENT`, `WHATSAPP_ENABLED=true`).
- `ANTHROPIC_API_KEY` on Railway to turn the free AI help on (it is off until then).
- Domain + `FRONTEND_URL` / `VITE_PUBLIC_URL` + Search Console.
- Optional: Vercel Pro (~$20/month) so previews and repeated deploys stop hitting the 100/day limit.

## 10. Sign in with Google / Spotify / YouTube, connected accounts, and account merging — design

**What exists:** email + password, emailed one-time codes, email verification, `GET /auth/methods`. No OAuth, no token storage. Profiles hold `website` and `portfolio_url` only; work links live as portfolio items. Pages (bands, studios) exist through the acting-as layer.

**Provider reality (checked on the providers' own docs, Sept 2026):**
- **Google** — the only provider fit for primary sign-in: verified email, name, photo; YouTube is the same account, so "Connect YouTube" is just an extra scope (`youtube.readonly`) requested later, not at sign-in. Sensitive scope → Google OAuth verification (brand + privacy policy), no security audit.
- **Spotify** — OAuth works, but new apps sit in Development Mode (25 users) and extended access is now "reserved for established use cases". So: **no Spotify sign-in at launch**; Spotify *import* needs no user login at all — the public API (client credentials) reads any artist link. Revisit sign-in when Spotify grants extended access.
- **Instagram** — personal-account API is gone (Dec 2024); "Business Login for Instagram" works only for Business/Creator accounts and needs Meta app review with the `instagram_business_basic` scope. Most working musicians have Creator accounts. **Connect Instagram = phase 2, after app review.** Never a sign-in method.
- **Apple / Facebook** — skip (Apple only matters with an iOS app).
- **WhatsApp OTP** (phone) — the most seamless option for Indian musicians; needs the Meta WhatsApp setup already planned. Week 3.

**Data model:** one table `auth_connections`: `owner` (polymorphic: User or Page), `provider` (google, youtube, spotify, instagram), `provider_uid`, `email`, `email_verified`, `display_name`, `avatar_url`, encrypted `access_token`/`refresh_token` (ActiveRecord encryption; keys on Railway), `scopes[]`, `expires_at`, `raw` jsonb, `last_synced_at`. Unique on (`provider`, `provider_uid`). A YouTube channel or Spotify artist links to exactly one owner at a time; a Page connection can only be made by a Page owner/admin.

**Merge rules (the "seamless" part, and the safe part):**
1. Sign in with Google → email E, verified by Google. No account with E → create it (role picked on the next screen, reusing `/join`). Account with E exists → **auto-link and sign in** (a provider-verified email is proof of ownership), and email the account: "Google sign-in was added". Already linked → sign in.
2. Any provider whose email is missing or unverified (Spotify, Instagram) → never link by email; ask for an email, send the code, link only after it is entered.
3. Signed-in user clicks "Connect X" → links to *that* account, whatever the email. If the X identity is already linked to another account → refuse with "already connected to another Verse account — sign in with X to use it, or ask us to merge".
4. Password accounts keep their password. Settings → "Sign-in methods" lists email+password, email code, Google, each removable (never remove the last one), each with a disconnect that also revokes the token at the provider.
5. Two accounts for one person with different emails → admin merge tool in beta (move connections, portfolios, applications to the older account; audited); self-serve merge (verify both emails) later.

**Permissions:** ask for the minimum at sign-in (openid, email, profile). Every extra scope is a separate, explained button: "Connect YouTube — we read your public videos and channel to build your portfolio. We never post or change anything." Scopes granted are shown in Settings; consent is recorded (DPDP).

**Individual vs band/studio:** a person connects their own Google/YouTube; a Page connects its channel/artist page from the Page's settings. Imports land in the Page's library; the owner builds that Page's portfolios from there. The same person can therefore own a personal YouTube and a band YouTube with no confusion.

**Build sequence:** week 1 — Google sign-in, `auth_connections`, merge rules 1–4, Settings UI (omniauth + `omniauth-google-oauth2` + CSRF protection gem; backend handles the redirect flow and hands the SPA a one-time code). Week 2 — Connect YouTube (incremental scope) and channel import into the library; Spotify public-API import; submit the Meta app review. Week 3 — WhatsApp OTP. Week 4+ — Connect Instagram.

**Owner actions:** Google Cloud project → OAuth web client, consent screen, brand verification, redirect `https://<API host>/auth/google/callback`; Railway secrets `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, plus the ActiveRecord encryption keys. Spotify developer app → `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`. Meta app (later).

## 11. The name and the domain

**Is "Verse" a great name?** Good working name, weak brand to "make completely popular". For: one syllable, musical, easy in Hindi and English. Against: crowded — Verse (US AI creative app, $21M Series A, 10M+ users), Verse Music Group (NYC publisher), Verse-Chorus (songwriter collaboration site), several "MusicVerse" apps; `verse.com`, `verse.app`, `verse.in`, `verse.co.in`, `getverse.*`, `joinverse.com` are all taken; a dictionary word is hard to trademark and impossible to rank for on its own. None of these is a music *hiring* marketplace in India, so there is no direct conflict — but nobody searching "verse" will ever find us.

**Recommendation:** do not rename before launch — there are no users yet to confuse, and the beta will teach us more than a naming exercise. Buy insurance now and decide the brand in month 2 with data.

Registry checks (RDAP, today): **available** — `versemusic.in`, `joinverse.in`, `hireverse.in`, `verse.music`, `verse.co`, `verse.io`, `verse.so`, `verse.gigs`. Taken — `verse.in`, `verse.co.in`, `verse.com`, `verse.app`, `getverse.in`, `verseapp.in`, `tryverse.in`, `joinverse.com`, `getverse.com`.

Buy: **`versemusic.in` as the primary** (says what it is, Indian TLD for Indian SEO, cheap), plus **`verse.music`** (the memorable one; the `.music` TLD is limited to the music community, which fits) and **`verse.co`** as redirects if the price is sane — five-letter `.co`/`.io` names are often marked "premium", so expect anything from ₹2,500 to several lakh; walk away above ~₹15,000/year. Skip `.so` and `.gigs`. Then: point `FRONTEND_URL` and `VITE_PUBLIC_URL` at the primary, add it in Vercel, keep `verse-music-platform.vercel.app` redirecting.

**Trademark:** have the lawyer run the IP India search for "VERSE" in classes 42 (software/platform) and 41 (entertainment services) — I could not query the registry from here. If clear, file a word + logo mark in India before any public marketing (~₹4,500 government fee per class plus the lawyer). If a conflicting Indian mark exists, that is the moment to choose an ownable name, and the `.in` domains above cost almost nothing to let go.

## 12. Community and growth engine — what is being built and how it is run

**Principle:** nobody stays for a profile; they stay because something happens every week — a request near them, a name they know getting verified, a fast responder being celebrated, a meetup on Friday. Every mechanism below produces an event that goes to the Stage, to the weekly email, and (where the user agrees) to their Instagram/WhatsApp.

### Built now (PRs in flight, all specified to the letter)
| Loop | Mechanism | Where it shows |
|---|---|---|
| **Acquisition: the badge is the ad** | Every verified musician gets a 1080×1920 "Verified on Verse" story card with QR + profile link, a WhatsApp share button and a copy-link button. Musicians post badges; their followers are exactly the people we want | Profile after approval, approval notification |
| **Acquisition: vouching** | Verified musicians vouch for up to 3 people they've worked with; vouched sign-ups are reviewed first. No cash — status | Musician dashboard card, admin queue |
| **Acquisition: hirer Early Access Pro** | Pro free for 90 days, no card, first 50 hirers you approve | Admin action, billing page |
| **Acquisition: search** | Role × city pages (`/hire/drummer/mumbai`), city rates pages, dynamic sitemap, share previews on WhatsApp | Google, WhatsApp |
| **Activation** | Paste one link → drafted profile; lifecycle emails day 1/3/5/10 (add work, get verified, set availability, add rates); hirers day 1/3/7 | Email, dashboard |
| **Retention: the Stage, alive from day one** | System posts: welcomes, "X is now Verified", "a drummer request in Mumbai was filled in 3 hours", Monday "who's looking, who's free" pinned thread, fastest-responder shout-outs, meetups strip with ICS | Stage (sign-in only) |
| **Retention: weekly digest (Tuesday 09:30 IST)** | Musicians: requests + jobs matching you, your profile views, who got verified in your city, requests filled this week. Hirers: newly verified people for your roles, your listings' status, response times, fastest responders | Email, with four-toggle preferences and one-click manage |
| **Retention: status** | Fastest-responder weekly badge; response-time line on profiles ("usually within 20 minutes"); milestone emails (first response, 100 views, 5th fill) | Profile, talent card, Stage, email |
| **Trust → repeat** | Review prompts after every fill/booking (both sides, one reminder), verification shows what was verified, requests never go silent (expiry with notice), jobs auto-close at deadline | Everywhere |

### Run by you (the product supports each step)
**Weeks 1–2 — Mumbai seed (target: 100 verified musicians, 15 hirers).** Personal outreach to your network and 5–8 WhatsApp groups; send each person one line and the paste-a-link sign-up; verify within 24 h; every verified person gets the "share your badge" nudge. Post the first meetup (a jam or an open mic) on the Stage. Approve listings within 2 hours.
**Weeks 3–6 — Mumbai density (target: 400 musicians, 40 hirers, 30 filled requests).** Weekly rhythm: Monday pinned thread, Tuesday digest, Friday "fastest responders" post, one meetup a fortnight. Ask every filled request for a review and a badge share. Onboard 3 studios, 5 wedding-band leaders, 3 event companies on Early Access Pro. Start Instagram: only real stories ("booked a keys player in 3 hours").
**Weeks 7–12 — Second and third city (Delhi-NCR, Bengaluru).** Repeat the seed playbook with a local "city lead" musician (give them a badge and admin-lite powers to pin events); open role × city pages when ≥5 profiles exist; run one paid experiment (₹25k Instagram reels to musicians in each city) and measure cost per verified sign-up.
**Months 4–6 — Compounding.** Referral K-factor tracked weekly (sign-ups from share cards + vouches ÷ active users); musician Pro tier experiment only if fill-rate ≥70%; The Stage opens to public reading (SEO) once ≥2,000 posts.

### The weekly scorecard (admin Funnel tab + digest data)
New sign-ups by source (share card / vouch / hire page / direct) · % publishing a profile within 24 h · verified count and median time to verify · urgent requests filled within 24 h · median first response · digest open rate and opt-outs · Stage weekly active commenters · badge shares · reviews written ÷ fills.

### Owner action this week (blocking the digests)
Brevo's free tier sends about 300 emails/day. One weekly digest to 1,000 people breaches it. Move to a paid Brevo plan (their 20k-emails/month tier is roughly ₹1,500–2,500/month) before the first digest goes out; the Railway variables stay the same.

## 13. Ten lakh users in six months — an honest assessment

**Is it realistic?** For a professional two-sided marketplace, no — and saying otherwise would be the foolish thing. The arithmetic: 10,00,000 users in 180 days is ~5,500 sign-ups every day from day one, sustained. Comparable platforms: StarClinch reached ~30,000 artists in ten years; Talentrack ~7,00,000 registrations across *all* performing arts (actors, dancers, models, singers) in about eight years with heavy advertising; Vampr ~1.5 million globally in eight years; Encore (UK) is measured in bookings (50,000), not members. India's total population of working musicians, crew and music professionals is itself probably in the low lakhs (no reliable count exists; IPRS has ~15,000 members). You cannot have 10 lakh *professional* members in a market that may not contain 10 lakh professionals.

**What 10 lakh could mean, and what I recommend targeting:**
- **10 lakh people reached** in 6 months (profile views, share-card impressions, WhatsApp previews, hire-page visits) — realistic with the badge loop and SEO pages; this is the number that builds the brand.
- **1 lakh registered members** — possible only with paid acquisition on top of the loops (₹80–200 per sign-up on Instagram for this audience → ₹1–2 crore) and by widening who counts as a member (learners, music students, hobbyists, fans who follow musicians). That widening changes the product.
- **25,000–50,000 professionals and 3,000–5,000 hirers across 3–4 cities with ≥70% urgent fill-rate** — ambitious, achievable with the plan in §12 and ₹10–20 lakh of marketing, and it is the number that makes the business real. This is my recommended six-month goal.

**What would have to be true for 10 lakh members:** a consumer layer (audiences following musicians, ticketed meetups, learners finding teachers) so the app has a reason to exist for people who are not being hired; a K-factor above 1 (each member bringing more than one member — the badge loop alone will land around 0.1–0.3); a ₹5–15 crore acquisition budget; and an app in the stores. That is a different company plan; the plan in §12 keeps the option open (the Stage, meetups, public profiles) without betting on it.

**How ready is the platform for growth?**
- Verified by load test on the production-mode copy: one Puma process serves ~100 requests/second with 0 errors; three processes ~380 rps. At 1 lakh members (≈5,000 daily active, ~50 rps at peak) the current single process is enough; at 5 lakh it needs two processes and a 2 GB Railway plan (a variable and a plan change, no code).
- What breaks first is not compute: (1) **email quota** — Brevo free breaks at ~1,000 members once digests start (above); (2) **you** — verification, listing approval and concierge matching are manual by design in the beta; past ~150 verifications a week you need a second reviewer (the admin already supports multiple admins); (3) **database hot queries** at ~50,000 profiles — the index audit I paused (scale-readiness package) should run when members pass 20,000; (4) **WhatsApp alert costs** — Meta charges per utility message in India; 15 alerts per urgent request × 300 requests/month ≈ 4,500 messages, roughly ₹1,500–2,500/month at current rates (verify on Meta's pricing page).
- Not yet built for 1 lakh: a public Stage (SEO), city leads with limited admin rights, in-app WhatsApp digest, native apps. Each is a normal next step, not a rewrite.

## 14. Verification automation (WP-I, builds after the connections and mechanics packages merge)

**Principle:** automate evidence gathering and scoring; auto-approve only strong evidence with proven identity; never auto-reject.

**Evidence layers (machine-collected):** identity — WhatsApp-verified phone or Google sign-in, name consistency; work — OAuth-connected YouTube/Instagram (ownership proven), computed link signals (channel age, counts, name match, role keywords vs taxonomy, link reuse across profiles → block), on-platform completed fills/bookings with reviews (strongest); community — vouches from verified musicians.

**Score 0–100** (identity 30, proven-ownership links 30, signal consistency 20, vouches/on-platform 20) stored with a breakdown on the verification request.
- ≥75 + identity verified + no flags → auto-approve, `checks: [identity, work_links]`, 10% random audit sample to the admin queue.
- 40–74 → queue with a three-line Haiku summary (new AI task `verification_summary`, launch-mode allowed, admin-only, budget line ₹300/month) and one-click approve/reject.
- <40 → queue with reasons; the musician automatically receives "add more proof" guidance.
- Rejections and revocations are always human; a report on a verified profile re-opens the case.

**Badge tiers:** Verified (identity + work links); Verified Pro (+3 completed fills/bookings with reviews). Both filterable by hirers.

**Fraud controls:** disposable-email block, link-reuse block, 3 requests per account per 30 days, IP/device clustering flag, one-click reversal with audit trail.

**Expected effect:** 40–60% of genuine musicians verified in minutes; the rest reviewed in ~20 seconds each. Removes the owner as the bottleneck until well past 10,000 members.

## 15. Codes, referrals and annual plans (merged, #120)

- **One code system, managed in the admin Codes tab:** `discount_percent` (X% off Pro/Studio for N billing periods), `extended_trial` (N free days instead of 14), `early_access` (grants Early Access Pro, seat-capped), and `referral`. Vanity codes (`MUMBAI50`) or generated batches in a configurable format (`VERSE-XXXXXX`), with plan/interval scope, max redemptions, one-per-user, start/expiry, deactivate, redemptions list and CSV export.
- **Referrals:** every user gets a code (`VERSE-RAHU7K2P`) from their billing page with a WhatsApp share. Referee gets 20% off for 3 cycles; referrer gets 30 free days per paying referee, capped at 6. Programme settings live in `backend/config/billing.yml`.
- **Annual plans:** Pro ₹24,990/yr, Studio ₹59,990/yr ("2 months free"), monthly/annual toggle on pricing. Hidden automatically until the annual Razorpay plan ids are set.
- **Razorpay rule:** percentage discounts on live subscriptions need a Razorpay Offer — paste each code's offer id in the Codes tab (the tab warns when one is missing). Trial and Early Access codes need nothing.
- **Owner:** Razorpay → create annual plans → Railway `RAZORPAY_PLAN_PRO_ANNUAL`, `RAZORPAY_PLAN_STUDIO_ANNUAL`; create the referral offer (20% × 3 cycles) → `RAZORPAY_REFERRAL_OFFER_ID`.

## 16. Verification automation (merged, #121)

Implemented as designed in §14: evidence score 0–100 with breakdown and flags; auto-approve at ≥75 with proven identity and no flags (10% random audit sample to your queue); AI three-line summaries for 40–74 (₹300/month budget, template fallback); "add more proof" guidance below 40; never auto-reject; one-click approve/revoke; "Verified Pro" tier (verified + 3 completed fills/bookings + a review). Thresholds in `backend/config/verification.yml`. Organisation requests are scored but always human-approved.
