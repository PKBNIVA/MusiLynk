# Launch-2 handover

Written 2026-09-30 by the integration session (replaces the earlier partial note). Stopped here by design: B7, B8, B10 and B6 are not started.

## What merged
| PR | What | Into |
|---|---|---|
| #137 | B3 landing, public pages, OG images (ownership grants recorded) | `claude/launch-2` (`e15072d`) |
| #136 | B2 cards, profile, ranking, filters (after merging launch-2 into the branch, gates re-run) | `claude/launch-2` (`dc9ed44`) |
| (direct push) | Plan update: Owns amendments, §6 figures, §4.6 audit register, B10, §1.3 and §8 (production merged into launch-2 first, because launch-2 lacked the plan file) | `claude/launch-2` (`82b852d`) |
| (direct push) | Fix: `consented_at` back in the signed-in user's own payload; employer leg of the integration journey follows B4's one-screen join | `claude/launch-2` (`d6d4546`) |
| #138 | Launch-2 into production (B9, B0, B1, B5, B4, B2, B3 + Vercel rule + plan) | `production` (`8926fe3`) |
| #139 | Hotfix: stop deploying the OG edge function (see Deviations) | `production` (`5c46197`) |

Earlier in the launch: B9 #130, B0 #131, B1 #132, B5 #133, B4 #134 (merged by the orchestration session).

## What is live
- Production head: `5c46197` (merge of #139). API release serving at the time of writing: `8926fe387a87` (#138); the `5c46197` Railway redeploy only carries a comment change on the backend and was queued behind the QA Agent run (see Verification).
- Vercel production deployment `dpl_7A8uHeMomSnfntNWUqFiB84CJwKF`: READY for `5c46197`.
- Showcase seeded: `demo-showcase` with 110 musicians, 40 hirers, 45 jobs, 60 applications, 25 conversations, 12 bookings, 12 acts, 8 urgent requests, 18 reviews, 40 posts.

## Verification (2026-09-30, UTC)
- `https://verse-music-platform-production.up.railway.app/api/readiness` returns `{"ok":true,...}`.
- `https://verse-music-platform.vercel.app/` returns 200 with the B3 head (theme-color, manifest, apple-touch-icon); `/manifest.webmanifest` is `application/manifest+json`; `/img/sitar-trio-1600.webp` is `image/webp`; `/hire/drummer/mumbai` has its own prerendered title and canonical; the B3-only chunk `LandingBelowFold` contains "Latest from The Stage".
- `/api/public/talent?limit=40` lists 40 people, every one with `demo: true`, 33 verified; total 111 (110 demo + the owner). Demo profiles carry no photo (art avatars).
- `/api/public/stats`: organic counts `professionals: 1, verifiedProfiles: 0`; the `listed` block counts the demo people (111 / 33).
- A demo profile's samples point at the app bucket `…r2.dev/demo/showcase/*.mp3`; a range request returns `206 audio/mpeg` (`Content-Range: bytes 0-1023/2005824`).
- `https://verse-music-platform.vercel.app/sitemap.xml` has 16 URLs and one `/professionals/` entry (the owner); no demo profile.
- `python3 scripts/ops/railway_seed_showcase.py check` shows `preDeployCommand []`.
- Backend: full suite 1629 runs, 0 failures on the B2 merge; `zeitwerk:check` ok; brakeman no warnings. Frontend gates and unit coverage (97.24% statements, 95.19% branches) passed before each push. PRs #138 and #139: rails, frontend, security, integrated-journeys and local-experience all green.

## Deviations and things to know
1. **Vercel deploy failed after #138** (not quota, not auth). Deployment for `8926fe3` was `ERROR` at `direct:build`: "The Edge Function api/og is referencing unsupported modules: @vercel: module". Vercel shipped `api/og` unbundled with the dynamic `import('@vercel/og')` as a bare specifier, and one rejected function fails the whole deploy, so the frontend stayed on the older build. Fix (#139): `api/og.ts` moved to `edge/og.ts` (not deployed; its unit tests run against the new path; `tsconfig.json` includes `edge`), and `vercel.json` rewrites `/api/og/:type/:id` to the static `/og-default.png`, so every share-page `og:image` URL stays valid. **Parked:** rebuild the per-share OG card as a properly bundled function (B3 item 5 is therefore partly delivered: meta tags, prerender and Googlebot path are live; per-share images are the default card).
2. **Seeding deployment shows FAILED in Railway** (`d332664a`). The one-off pre-deploy run printed the `demo:showcase` counts above and the data is live, but the run ended with `Sentry::ExternalError` 403 (the known wrong `SENTRY_DSN`, owner item). I did not verify that this error is what set the non-zero exit. The previous good deployment kept serving, and `preDeployCommand` was reset to empty.
3. **Merge of launch-2 into `claude/l2-b2` was denied once** by the auto-mode classifier ("Merge Without Review"); done after the owner approved it in chat.
4. **`consented_at`:** B0's allow-list had dropped it from the signed-in user's own `/me` payload, failing the integrated-journeys job on #138. Restored in `ACCOUNT_KEYS` (own and admin-list payloads only; anonymous payloads are unchanged).
5. **Plan §1.3** lists the production PR as "(this PR)" (it is #138) and does not list #139.
6. Extra ownership grants recorded in §7 for B2 and B3 beyond the five the task listed.
7. Environment: backend gems were installed with `bundle install`; Playwright was run with an untracked local config pointing at the installed Chromium (the repo pins a newer build); `claude/master-plan` was fast-forwarded by merging production into it.

## Parked (not started)
- **B7 hirer flows:** A-09 quote drops the musician, A-10 deposit dead-end, A-11 free-trial button under the payments banner, draft accumulation, `verificationPending` on `GET /me`, `FormDialog` footerNote.
- **B8 musician flows:** A-31 Stage cursor, A-32 Stage photo URLs, A-33/A-34 notifications, A-30/A-35 author identity, A-36 review-prompt link, A-39 hashtags, A-01 add-from-link, A-07, A-04, A-05, A-37 return path, #16 Other-role cap, `StageAuthor` and `GoogleSignIn` avatar nits.
- **B10 admin console and one-liners:** A-14 lifecycle email double prefix, A-20 header at 360px, A-22/A-23 admin badges and pager, A-24 reports overflow, A-26/A-27 founder note and tab URL, A-28 (+A-29) expired session on Stage, A-38 follower count, `zz-landing-shots.spec.ts` selectors, digest/response-time demo reads, `lifecycle_emails.delivered_at`.
- **B6 copy sweep:** US dates, INR vs ₹, raw enum strings, `helpContent`, native date inputs, raw applicant email, repeated system posts, repeated CTAs, self-report guard, expired-session explanation, `formatPay` periods, "Music professional" wording.
- **Also:** per-share OG image function; acceptance re-check of A-03/A-13, A-12, A-19, A-25, A-08/A-15, A-16, A-17 (fixed in launch-2); `docs/API.md` for the B2 filter params and `bookingsCount`; a musician-level quote needs B7's booking endpoints.

## Owner actions still open (plan §8)
- `SENTRY_DSN` points at the wrong project (Sentry rejects events with `ProjectId`).
- Real `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` on the web service.
- `RAZORPAY_REFERRAL_OFFER_ID`.
- `backend/config/legal.yml` (legal entity, address, GSTIN, grievance officer); the invoice print page has an empty heading until then.
- WhatsApp variables, `QA_SMOKE_EMAIL` / `QA_SMOKE_PASSWORD`, Brevo plan, domain and Search Console.
- When the showcase should go: Admin → Demo data → Delete `demo-showcase` (the 40 mirrored MP3s stay in the bucket under `demo/showcase/`).
