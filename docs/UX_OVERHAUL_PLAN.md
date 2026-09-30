# Verse UX overhaul plan

Evidence: 749 measured screens (public, join, auth, musician empty+filled, hirer empty+filled, admin) at 1440×900, 390×844 and 1024×768, ~1,300 screenshots, plus my own walkthrough of every musician screen. Local production-mode copy at production head 9b5e7f8 with 1,000 demo accounts. Date: 2026-09-30.

## 1. Diagnosis — why it feels boring and text-heavy

The product is not badly built; it is built from **one template repeated on every screen**:

```
EYEBROW LABEL                                   [gradient button]
Big two-line headline
One-sentence subtitle explaining the headline.
┌──────────────────────────────────────────────────────────────┐
│ ? How X works   • step one text  • step two text  • step three│
└──────────────────────────────────────────────────────────────┘
[ stat ] [ stat ] [ stat ] [ stat ]
… the actual content starts here, usually below the fold …
```

Measured across the app (desktop, above the fold, before any real content):

| Area | Screens | Median words | Median buttons | Images / illustrations |
|---|---|---|---|---|
| Musician app | 105 | **143** | 12 | **0** |
| Hirer app | 192 | **142** | 8 | **0** |
| Admin | 109 | **187** | 18 | 0 |
| Public pages | 37 | 111 | 2 | 0 |
| Join / auth | 33 | 69–100 | 3–7 | 0 |

- The explainer band (`HelpCallout`, 16 pages) plus eyebrow + headline + subtitle (31 pages) costs 60–90 words and 250–330 px on every screen before the user sees anything they came for.
- **Zero images or illustrations above the fold on any screen.** A music marketplace with no media in its first view reads as a SaaS admin tool.
- 90 screen states have **no primary call to action** (every Post-opportunity step, Candidates, Compare, Build my crew, Bookings, most admin tabs) — the eye has nowhere to go.
- Everything is the same weight: same card, same border, same purple gradient for "Explore opportunities", "Create opportunity", "Search", "Send enquiry". When everything is highlighted, nothing is.

### What is highlighted vs. what should be

| Screen | Highlighted today | Should be highlighted |
|---|---|---|
| Musician dashboard | 5-step tour modal blocks the page; "Welcome back" toast; "How Verse works" band; profile strength "100% → Improve profile" | **"5 urgent requests near you — respond"**, then new messages, then best fits |
| Find work (450 results) | Yellow **DEMO** badge on every card is the brightest element; 6 metadata rows per card | Job title, pay, date, city, "Apply" |
| Best fits | "35% fit" / "47% fit" chips in sky blue | Only fits worth showing (≥60%), as "Good fit" — low scores discourage |
| Hirer dashboard | Amber "Review note: Compensation not disclosed" on the first card | New applicants, live opportunities with applicants, "Post" |
| Candidate search | Checkbox + "View proof" ghost buttons; bios in body text | Photo/initial, role, verified badge, one play chip, "Message" |
| Hirer applications | Applicant **email address** printed on every card (privacy issue), "Message" is the primary button before shortlisting | Name, role, city, sample; primary = "Shortlist" |
| Public profile | Name + bio paragraph; no media until below the fold; "Sign in to hire" at the bottom | Hero: avatar, role, city, Verified, **play sample**, "Book / Message" sticky |
| Admin | 7 stat tiles + 17 tabs + an info banner on every tab | The queue that needs a decision now |

### Bugs found while crawling (fix regardless of design)
1. `/favicon.ico` 404 on every page (console error on every screen).
2. `/login` is a 404 page — should redirect to `/auth/jobseeker`.
3. Messages first paint takes 2–4 s (lazy chunk + conversation fetch chain); users see an empty page.
4. Hirer applications cards print the applicant's raw email before shortlisting.
5. Admin opportunity queue shows "Compensation: INR ?–?" when pay is undisclosed.
6. `/portfolio` returns 403 for a hirer creating their first portfolio (dead end).
7. Post-opportunity: the free-plan limit surfaces as a 402 only on submit, after four steps.

## 2. Design principles (binding for every brief)

1. **One job per screen, one primary button.** Everything else is secondary (outline) or tertiary (text). The primary button's colour appears nowhere else on the screen.
2. **Content in the first fold.** Page header = title only (`text-2xl`, 1 line) + at most one 12-word line when the page is empty. Eyebrow labels and subtitles are removed from app screens. `HelpCallout` becomes a "How this works" text link that opens a popover — never rendered open by default.
3. **Word budget above the fold:** app screens ≤ 60 words, public pages ≤ 90, mobile ≤ 40 before the first content card.
4. **Show, don't tell.** Every content card carries one visual: avatar (initials with a per-user hue), a play chip for a work sample, a format glyph for a job (session / gig / tour / audition / teaching), a city chip. Public profile and job details get a media hero.
5. **Colour = signal.** Reserve colour for state that changes what the user should do: Verified (green), Urgent (amber), Live / unread (accent), errors (red). Demo badge becomes a small grey outline. Fit scores are hidden below 60%.
6. **Forms: ≤ 5 visible fields per step.** Optional fields live under a "More details" expander. Show plan limits before the form, not after it.
7. **Empty states = illustration + one sentence + one button.**
8. **Mobile first fold** contains the CTA; the explainer never renders on mobile; the bottom nav stays.
9. **No interruptions on entry.** No welcome toast, no modal tour. First visit gets a dismissible 3-card strip inside the page.
10. **Navigation reflects the job.** Musician: Overview · Find work · Stage · My work · Messages (Hire moves under the "You" menu as "Hire someone"). Hirer: Overview · Post · Find talent · Applicants · Messages.

Targets after Wave 1: median words above fold ≤ 60 (app), buttons ≤ 6, every content screen ≥ 1 image/illustration, 0 screens without a primary CTA, no form step with > 5 visible fields outside admin.

## 3. Per-screen plan

### Public
- **Landing** — keep the hero (it is the strongest screen). Cut "Something else? See every way to use Verse". Replace the example card's three text rows with play chips + a real waveform strip. Add a row of 6 musician avatars with city chips under the hero ("Verified in Mumbai this week"). Move "How it works" to three icons in one row, ≤ 8 words each.
- **Directory (/music-professionals)** — headline to one line ("Musicians in Mumbai"), 60 words less. Cards: avatar + name + role + city + Verified + one play chip; bio truncated to one line. Filters as chips (role, city, verified) instead of two text inputs.
- **Public profile** — hero band: large avatar, name, role · genres, city, Verified, a play chip row; sticky "Book / Message" on the right (desktop) or bottom (mobile). Credits become a compact list; work samples become media tiles with a play button.
- **Job details** — title + pay + date + city in the first 300 px; "Apply" sticky. Demo badge to grey outline.
- **Pricing** — headline to "Plans for hirers. Musicians are free." Move the "server-enforced trials" pill out (it is engineering language). Early Access Pro banner above the plans.
- **Hire pages / rates** — reduce to: headline, 4 musician cards, rate table, FAQ accordion (collapsed).
- **Join (musician)** — keep three steps; step 2 ("Your work") leads with the paste-a-link importer as the hero input, not a list of fields. Step 3 offers Google first.
- **Join (hiring)** — 8 fields on one step → 4 (company, city, what you hire for, email) + "More" expander.

### Musician app
- **Dashboard** — order: (1) "Needs you now" strip: urgent requests near you, unread messages, booking to confirm; (2) "Good fits" (≥60% only, max 3, with format glyph); (3) profile nudge only when < 80% complete; (4) stats moved to the bottom as one line. Remove tour modal, welcome toast, explainer.
- **Find work** — header to one line; search bar + 4 filter chips; results as compact rows (title · company · pay · city · closes) with a format glyph; bookmark on hover. 450 results need a sticky filter bar.
- **Profile** — 4-step wizard → one page with anchored sections (About, Skills, Rates & links, Verification). "Request verification" becomes a secondary button in the header; the primary is "Save".
- **My work (library)** — good bones; drop the explainer; tiles get a thumbnail/play chip; "In no portfolio yet" → neutral "Add to portfolio".
- **Applications** — status pipeline is good; drop the explainer; add the employer's avatar.
- **Stage** — composer collapsed to one line ("Share what you're working on…") that expands on focus; genre/city inputs move under the expander; explainer removed.
- **Book talent (as musician)** and **Hire** — moved out of the main nav.
- **Settings** — fine; WhatsApp block shortened to two lines.

### Hirer app
- **Dashboard** — order: (1) "New applicants" (avatars + names + "Review"); (2) live opportunities with applicant counts; (3) "Post an opportunity" and "Need someone by tomorrow" as two visual cards when there is nothing live. Stats to a single line.
- **Post opportunity** — 4 steps → 3 (What & where · Pay & dates · Screening & review). Templates row stays at the top. Show the plan limit before step 1. ≤ 5 visible fields per step.
- **Find talent** — results as cards with avatar, role, verified, play chip, "Message" primary; compare tray docked at the bottom instead of a right column.
- **Applicants** — remove email; card = avatar, name, role, city, sample chip, screening answers collapsed; primary "Shortlist", secondary "Message".
- **Urgent request** — 11 fields → 5 required (role, date, city, budget, note) + "More details".
- **Build my crew / Band builder / Acts** — same treatment: title, one-line hint, form ≤ 5 visible fields.

### Admin (lower priority — internal)
- Overview: 7 tiles → 4 (queue, verification, reports, revenue); tabs grouped into Trust · Growth · Money · System.
- Codes dialog: 15 fields → progressive (kind → then only that kind's 4–6 fields).
- Verification and opportunity queues: split-pane list + detail, decision buttons fixed at the bottom.

## 4. Waves, risk and timing

| Wave | Scope | Risk | Effort | When |
|---|---|---|---|---|
| **0 — De-clutter (shared components only)** | Remove eyebrow/subtitle from app page headers; `HelpCallout` collapsed to a link; kill welcome toast + tour modal (3-card strip); demo badge grey; fit-score threshold; musician nav (Hire → You menu); favicon; `/login` redirect; Messages preload; applicant email removal; admin "INR ?–?" | Low — no layout rewrites, all behind shared components | 1 Sonnet session, ~4 h incl. CI | **Before launch** |
| **1 — Dashboards, cards, public profile** | Both dashboards reordered around "needs you now"; job / candidate / applicant cards with visuals; public profile + job details heroes; directory cards + chip filters; empty-state illustrations (one SVG set, 8 scenes) | Medium — new components, screenshot review needed | 2 Sonnet sessions in parallel (musician side / hirer + public side), ~1 day each | Launch days 1–3 |
| **2 — Forms** | Post opportunity 3 steps; urgent 5 fields; profile single page; join (hiring) 4 fields; Stage composer collapsed; plan limit shown up front | Medium — touches validation and specs | 1 Sonnet session, ~1 day | Days 4–7 |
| **3 — Admin + polish** | Admin grouping, codes dialog, split-pane queues; mobile pass with the measurement script re-run | Low | 1 Sonnet session | Week 2 |

Gate for every wave: the same crawler re-runs the measurement script; a wave is accepted only when the targets in §2 hold for the screens it touched, CI is green, and I have looked at the fold screenshots.

## 5. Who does what

- **Fable (me):** this plan; one written brief per wave with ASCII wireframes, exact copy, component names and acceptance numbers; screenshot review after each wave; the go/no-go on each PR.
- **Sonnet:** implementation of each wave from the brief; re-running the measurement crawler; CI. Never chooses layout, copy or hierarchy — the brief fixes them.
- **Haiku:** copy audits (word counts per screen) and the SVG illustration set from a written style spec.
- **Opus:** not needed while the briefs are this specific; reserved for a screen where a brief fails twice.

Wave 0 starts now. Waves 1–3 start when Wave 0 is on production.
