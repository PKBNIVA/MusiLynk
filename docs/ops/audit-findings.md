# Verse audit findings

## Summary

The ten-lens crawl (11 agents, 312 raw findings) produced 311 unique findings. 41 P0-P2 bugs went to two verifiers each; the other 270 (P1 37, P2 137, P3 96; UX, visual, copy, trust, data, performance, SEO, a11y) were not verified. Reported severity of the 39 bugs with verdicts: P0 3, P1 22, P2 14; the 2 unverified bugs (IDs 15 and 16) have no severity in the output. Both verifiers confirmed 38; exactly one confirmed 1 (A-29, where the other verifier could not reproduce it and both rated it P3); 0 were refuted by both; 2 are unverified because all four verifier runs failed with API 529 errors. Verifiers rated two of the three P0s lower (A-18 and A-31, both to P1); A-32 stays contested between P0 and P1. Three confirmed pairs are duplicates (A-03/A-13, A-08/A-15, A-30/A-35), so there are about 35 distinct confirmed defects.

Reading guide: Sev shows the reporter's severity; '(v: Pn)' means both verifiers rated it lower. IDs A-01..A-39 follow the order of confirmedBugs in the workflow output (A-nn = index nn-1). Admin console and Stage bugs have no dedicated brief, so they are assigned to the nearest owner (B9 for admin and session infra, B8 for Stage).

## Confirmed

Both verifiers reproduced each of these. Ordered P0, P1, P2, then by ID.

| ID | Sev | Screen/route | Defect | Repro key | Suggested owner |
|---|---|---|---|---|---|
| A-18 | P0 (v: P1) | /jobseeker/urgent and /employer/urgent | One long unbroken string in an urgent request stretches layout to 1560px and hides the respond dialog. | Open /jobseeker/urgent at 390px with the 3000-char request seeded. | B2 cards/profile/ranking/filters |
| A-31 | P0 (v: P1) | /stage | Stage home feed cursor never advances; infinite scroll repeats the same 20 posts, 'all caught up' never appears. | Scroll /stage three times; compare post ids. | B8 musician flows |
| A-32 | P0 | /stage | Photos attached to Stage posts render as grey boxes for everyone but the uploader's session. | Post a photo, reload or view as another user. | B8 musician flows |
| A-01 | P1 | /jobseeker/library | Add-from-link dialog says 'Added' but Close or Escape discards the link; it saves only via Draft then 'Add to my work'. | Library, Add from a link, paste SoundCloud URL, Add, Close, reload. | B8 musician flows |
| A-02 | P1 | /professionals/:id | Public profile never shows the day rate that the profile form says will be public. | Save day rate in profile wizard; open public profile as visitor. | B2 cards/profile/ranking/filters |
| A-03 | P1 | /join (via /signup) | /signup redirects to /join, which has no route and renders a 404. | Visit /signup. | integration fix |
| A-08 | P1 | /employer/post-job -> /opportunities/:id | Wedding template placeholders like [date] can be submitted, approved and published unchanged. | Post job, pick Wedding template, submit without editing. | B7 hirer flows |
| A-09 | P1 | /professionals/:id | 'Request a quote' on a musician profile opens the unfiltered book-talent list and drops the musician. | Open a musician profile, click Request a quote. | B7 hirer flows |
| A-10 | P1 (v: P2) | /employer/bookings | 'Resume deposit payment' dead-ends with raw 'Live payments are not configured.' toast. | Accept a quote, click Resume deposit payment. | B7 hirer flows |
| A-12 | P1 (v: P2) | /jobseeker/profile, /employer/profile | No field or flow to upload a profile photo or company logo; every user is an initials circle. | Walk profile wizard steps 1-4 as musician and hirer. | B2 cards/profile/ranking/filters |
| A-14 | P1 | email: musician_day1_first_link, day3, day5, day10, day21; hirer_day1, day3, day7, day14; milestone_* (LifecycleMailer) | Lifecycle email buttons double the workspace prefix (/jobseeker/jobseeker/...) and land on 404. | Open any lifecycle email CTA link. | integration fix |
| A-15 | P1 | /employer/post-job (Start from a template) → admin Opportunity queue | Duplicate of A-08: template brackets published verbatim; a live listing in the admin queue already has them. | Post job from template, submit; see admin Opportunity queue. | B7 hirer flows |
| A-19 | P1 | /music-jobs | Job cards force 603px width on phones; 'Sign in to apply' is off-screen. | Open /music-jobs at 360-390px. | B2 cards/profile/ranking/filters |
| A-20 | P1 | /jobseeker (all signed-in routes header) | At 360px the workspace hamburger sits fully off-screen; header needs 395px. | Sign in, open any /jobseeker page at 360px. | integration fix |
| A-21 | P1 | /urgent | Anonymous /urgent shows the signed-in header, bell, avatar and bottom tabs; tabs bounce to login. | Open /urgent logged out, desktop and mobile. | B3 landing/public/OG |
| A-22 | P1 | /admin (tab strip + Opportunity queue / Verification / Reviews) | Admin tab badges count the current page only: Verification shows 100 versus 303 real. | Open /admin; compare badges with /admin/stats. | B9 quality infra |
| A-23 | P1 | /admin Opportunity queue (page 2+) | Admin queue pager counts all 621 jobs but shows only pending; page 2 is empty; status filter is ignored. | Admin Opportunity queue, click Next. | B9 quality infra |
| A-24 | P1 (v: P2) | /admin Reports | One long report text makes the admin console 40,000px wide; Review button is off-screen. | Admin Reports with an unbroken 'RRRR...' report. | integration fix |
| A-25 | P1 (v: P2) | /admin Demo data | Admin cannot create demo data (cap 300, 1000 exist, no smaller size) or delete a single batch. | Admin Demo data, click Create demo data (Small). | B9 quality infra |
| A-28 | P1 | /stage | Expired session on /stage: token wiped, no redirect to sign-in, composer stays usable. | Invalidate token server-side, click Stage. | B9 quality infra |
| A-33 | P1 (v: P2) | /stage | Resharing your post creates no notification and no email for the original author. | Reshare a post; check author's notifications and email sink. | B8 musician flows |
| A-34 | P1 | /stage/posts/:id | Replying to a comment never notifies the commenter; only the post owner is notified. | Reply to a comment on a Stage post; check commenter's inbox. | B8 musician flows |
| A-35 | P1 | /stage/authors/user/:id | Author page for a member with no posts shows 'Loading...' and a '?' avatar; identity comes from posts[0]. | Open author page of a member without posts. | B8 musician flows |
| A-36 | P1 | /jobseeker/reviews | Review-prompt notification links to /reviews, which maps nowhere; 'Open' lands on the bare dashboard. | Trigger review prompt; click Open in notifications. | B8 musician flows |
| A-37 | P1 | /stage/posts/:id | Signed-out deep link to a Stage post is lost: login redirect has no return path. | Open /stage/posts/<id> logged out, sign in. | B4 forms |
| A-04 | P2 | /join/musician | 'Draft my profile from these links' returns a fully blank draft despite roles, city and links already entered. | Join musician, add two links, click Draft my profile. | B4 forms |
| A-05 | P2 | /join/musician | Spotify artist URLs are labelled 'Spotify track' and later saved as 'Spotify work sample'. | Paste open.spotify.com/artist/... in join step 2. | B4 forms |
| A-06 | P2 | /jobseeker/urgent | Urgent matcher uses substring match, so a Dholak player is shown 'Plays Dhol'. | Push 'Dhol player needed' request to a tabla/dholak musician. | B2 cards/profile/ranking/filters |
| A-07 | P2 | /jobseeker/review | Review suggestions cite 'title mentions Tabla' when title and description contain no such text. | Musician with Tabla role, open Review suggestions. | B8 musician flows |
| A-11 | P2 | /employer/billing | 'Start free trial' stays enabled under a 'Payments unavailable' banner and fails with raw 503 toast. | Employer billing, click Start free trial on Pro. | B7 hirer flows |
| A-13 | P2 | /signup | Duplicate of A-03: /signup redirects to nonexistent /join and shows 404. | Visit /signup. | integration fix |
| A-16 | P2 | /employer/post-job | Rapid double-click on Submit for review posts twice and creates two listings. | Post-job step 4, click Submit for review three times fast. | B4 forms |
| A-17 | P2 | /employer/post-job | Absurd pay and slot values pass client checks; server 422 surfaces only as raw model-text toasts. | Post-job, enter pay 99999999999999999999, submit. | B4 forms |
| A-26 | P2 | /admin Urgent matching → Candidates → Founder notes | Saved founder note disappears when the candidate row is collapsed and reopened until reload. | Admin Urgent matching, save note, Hide then show Candidates. | integration fix |
| A-27 | P2 | /admin (active tab) | Active admin tab is not in the URL; reload always returns to the queue. | Select Codes tab, reload. | integration fix |
| A-30 | P2 | /stage/authors/user/:id | Nonexistent Stage author page shows 'Loading...' forever with a live Follow button. | Open /stage/authors/user/<zero uuid>. | B8 musician flows |
| A-38 | P2 | /stage/authors/user/:id | Follower count stays '0 followers' after clicking Follow until reload. | Click Follow on any Stage author page. | integration fix |
| A-39 | P2 | /stage/tags/:tag | Hindi hashtags are not linked, and single-letter tags link to empty pages; frontend and backend patterns differ. | Post '#संगीत #a', open tag pages. | B8 musician flows |

Duplicate clusters (fix once): A-03 = A-13 (/signup); A-08 = A-15 (template placeholders, one validation rule); A-30 and A-35 are both Stage author identity from posts[0] (fix in one API change); A-31 is the cursor bug and A-32 the missing photo URL, independent.

## Refuted and disputed

No bug was refuted by both verifiers. One was split:

| ID | Title | Why |
|---|---|---|
| A-29 | Signed-in UI persists after token is gone; sends fail with 'Authentication required' | One verifier reproduced it only by deleting the token from localStorage by script; the other found no real user path (cleared site data reloads the app signed out). Both rate it P3. Residual gap: expired-token drafts are not preserved. |

## Unverified

Verifier IDs 15 and 16 have no verdicts, and the workflow output dropped their titles and details. The titles below are inferred from the verifiers' saved repro scripts in scratchpad/audit2/verify/15-* and 16-*; re-run verification before acting.

| ID | Inferred title | Basis |
|---|---|---|
| 15 | Anonymous /urgent renders the signed-in workspace header (UrgentHire.tsx mounts Navigation unconditionally) | Repro script loads /urgent logged out and prints header buttons; likely the same defect as A-21. |
| 16 | /join/musician 'Other role' field accepts 3,000 characters and the value is sent to /auth/register | Repro script fills #join-other-role with 3000 x's, advances the wizard and logs the register response. |

## Not bugs but notable

Unverified P3 items and opinions from the lenses that a product owner should still see (number in brackets is the index in the output's `other` list).

- [51] /urgent vs /employer/urgent (hirer-journey, P3 ux): Two urgent forms exist (/urgent and /employer/urgent) with different fields; hirers get an inconsistent request.
- [145] /jobseeker/jobs/:id (forms-bugs, P3 ux): 'Apply now' on a job submits instantly with no note, no confirmation and no undo.
- [127] /stage (musician feed) (copy, P3 copy): The musician Stage feed opens with five identical system posts ('A Drummer request in Mumbai was filled in 1 hour'); the community looks empty.
- [123] /community-guidelines, /safety, /accessibility, /contact (copy, P3 copy): Every support path in the legal and safety pages points to one personal-looking address, admin@alienbrains.in.
- [228] /api/legal/policy (trust-privacy, P3 trust): The legal policy API returns placeholder entity name and GSTIN that conflict with the hardcoded operator name.
- [230] /api/reports (trust-privacy, P3 trust): A user can file a moderation report against their own account.
- [91] /employer/applications (visual, P3 visual): The applicants list prints each candidate's raw email address under their name.
- [49] /employer/urgent, /employer/applications, /employer/notifica (hirer-journey, P3 copy): Dates appear in US format with seconds ('10/9/2026, 10:44:56 PM') across the product; Indian users read 10/9 as 10 September.
- [241] /auth/jobseeker (performance, P3 ux): An expired session sends users to sign-in with no explanation of why.
- [50] /employer (hirer-journey, P3 ux): The empty hirer dashboard repeats the same two calls to action three times.

Beyond these, 137 P2 and 37 P1 unverified items remain in the output (mostly copy, visual and UX); a copy sweep (B6) should take the US date format, 'INR' versus the rupee sign, and raw enum strings first.
