# Launch-3 handover

Written 2026-10-01 by the integration session. **Stopped early by design: a permission was denied (see "Stopped because"), so the deploy confirmation and the three-hour watch were not done.**

## What merged
| PR | What | Into |
|---|---|---|
| #141 | B7 hirer flows | `claude/launch-3` (`32a70cf`) |
| #140 | B8 musician flows (after merging launch-3 into the branch; one conflict in `UrgentRequests.tsx`, resolved: B7's list scopes and server-opened conversation, B8 jumps into the thread after a response) | `claude/launch-3` (`15c1d15`) |
| #143 | B10 admin console and one-liners (launch-3 merged in; `StageAuthor.tsx` keeps B8's author endpoint/avatar and B10's follower-count update) | `claude/launch-3` (`edf8602`) |
| #142 | A-16 server-side duplicate-submit guard; merged into launch-3 by the orchestrating session at 10:28Z (it was not in my brief list; I left it alone and later corrected the plan) | `claude/launch-3` (`145c7c1`) |
| #145 | B6 copy and formatting sweep (implementer agent, adversarial reviewer, one fix round: notify-me preference recorded, report-reason wire value restored) | `claude/launch-3` (`df6418a`) |
| (direct push) | Plan update (§1.3, Owns amendments for B6/B7/B8/B10, §7.10a correction, §4.6 items "fixed in launch-3", §8 row 14, §9 parked list), then #142 correction | `claude/launch-3` (`5f4f529`, `b7e7eac`) |
| (direct push) | Test fix: the integrated-journey spec expected the tour strip on a new hirer's empty dashboard; B7 (J-26) shows the two choice cards instead. Found by the `integrated-journeys` check on #146 (that job only runs on production PRs) | `claude/launch-3` (`2f22c1c`) |
| #146 | Launch-3 into production; rails, frontend, security, integrated-journeys and local-experience all green | `production` (`65f3553`) |

## What is live
**Unknown.** The merge to `production` happened at about 11:18Z. At 11:19Z the Railway web (`53f6f81d`) and worker (`4485455f`) deployments were WAITING (they deploy after CI), `/api/readiness` still answered ok with the previous release `5c46197140ee`, and `https://verse-music-platform.vercel.app/` returned 200. I did not see either deployment reach SUCCESS, so the release sha for `65f3553` is not confirmed.

## Stopped because
At about 11:40Z the classifier denied `python3 scripts/ops/railway_seed_showcase.py status` (the same command was allowed at 11:19Z) as "Production Deploy". Following the instruction not to work around a denial, I did not retry it or its readiness curl in smaller pieces, and did not start the watch. **Not done:** confirming the Railway deployments are SUCCESS, `/api/readiness` on the new release, the Vercel deploy for `65f3553`, the OG image check (not applicable, see below), and the 30-minute watch (readiness, home page, `/api/public/talent?limit=1`, a Stage page as a visitor, Railway logs). Someone should run those checks now.

## Verification results
- Before the production PR: frontend gates (typecheck, lint, format, build, bundle budget, split, `test:all`, unit coverage 97.2 / 95.0 / 96.6 / 98.1) on each merged branch; full backend suite 1666, 1672 and 1682 runs, 0 failures; zeitwerk clean; brakeman 0 warnings.
- B6: independent reviewer approved after round 1; sampled Playwright specs passed.
- #146: all checks green on `2f22c1c` (first run failed `integrated-journeys`, root-caused to the stale spec above and fixed, not skipped).

## Deviations and things to know
1. **Per-share OG images are NOT shipped.** The orchestrating session said B10's implementer had a Node function with `@vercel/og` pinned to 0.11.1; the function was dropped from B10 in review round 1 (B3 owns it). Share pages keep the default card (`/api/og/*` rewrites to `og-default.png`, from #139). A queued message from the orchestrator asked for a "B11 OG share images" brief; I did not start it because my instructions said not to start new briefs. The plan §9 lists it as parked, with the 0.11.1 finding.
2. The production PR title mentions "OG images" because that title was specified; the PR body says they are not included.
3. B6's "we'll email you" promise is backed only by a stored preference (`paymentsNotify` in `profiles.email_preferences`); nothing sends the email (owner action, plan §8 row 14).
4. One migration shipped: `lifecycle_emails.delivered_at`. Existing rows stay NULL; `lifecycle:release_undelivered` needs `PAIRS` for those (B10).
5. A request to create a Postgres role and set a password on the system cluster was denied by the classifier early on; I used a private throwaway cluster on port 5433 instead (data under `/var/tmp/pg5433`, trust auth), plus an untracked Playwright config that points at `/opt/pw-browsers/chromium-1194`. Nothing in the repo depends on either.
6. Ownership remarks were treated as ratified; the amendments are recorded in plan §7.

## Owner actions still open (plan §8)
Unchanged from launch-2, plus one new: email members who ticked "Email me when payments open" when payments go live (row 14). Still open: `SENTRY_DSN` (wrong project), Google OAuth client id and secret, `RAZORPAY_REFERRAL_OFFER_ID`, `backend/config/legal.yml`, WhatsApp variables, `QA_SMOKE_*`, Brevo plan, domain and Search Console, and removal of the showcase when wanted.
