# UX Wave 1 brief — dashboards, cards, heroes, empty states

Read `docs/UX_OVERHAUL_PLAN.md` §2 (principles) first; they are binding. This brief fixes layout, copy and component contracts. Implementers do not redesign; where the brief is silent, choose the plainer option.

Base: `origin/production` (Wave 0 merged, `0a73179` or later). Integration branch: `claude/ux-wave-1`. Track A commits the **shared kit** to `claude/ux-wave-1` first; Track B branches from that commit. Each track opens its PR **into `claude/ux-wave-1`**; the integration branch goes to `production` as one PR.

Facts that constrain the design:
- **No user photos exist** (no avatar column). Every "avatar" is an initials disc with a deterministic hue from the user id.
- `portfolio_items` have `kind`, `title`, `url`, `thumbnail_url`, `waveform_url` (both may be null), `year`, `roles`, `genres`. `WorkSamplePlayer` (`src/app/components/WorkSamplePlayer.tsx`, `compact` prop) already renders playable media.
- Jobs have `opportunity_kind` (job / gig / audition / session / tour / teaching / collaboration / internship …), `genre`, `location`, `workplace`, `compensation_min/max`, `compensation_period`, `application_deadline`, `applicationsCount`, `fitScore` (dashboard only).
- Dashboard payloads: musician `GET /api/dashboard` → `applications, interviews, saved, profileScore, recommendedJobs[], urgentNearby{count, items[{id,title,city,roleName,startAt}]}`; hirer → `jobs, published, activeJobs, applications, shortlisted, recentJobs[]`. Unread messages: `GET /api/conversations` rows carry `unreadCount`. Do not add backend endpoints in this wave; if a number is not available, omit that tile.

## Shared kit (Track A builds first, one commit, ≤ 90 min)

`src/app/components/kit/`:

1. `UserAvatar.tsx` — `{ id: string; name: string; size?: 'sm'|'md'|'lg'|'xl' (32/40/56/96 px); className? }`. Renders a disc with 1–2 initials (`AS`), background `hsl(h 55% 28%)`, text `hsl(h 90% 85%)`, `h = hash(id) % 360`. Font weight 700, letter-spacing 0.02em. `aria-hidden` when a visible name sits beside it, else `role="img" aria-label={name}`.
2. `FormatGlyph.tsx` — `{ kind: string; size?: 16|20|24 }` → lucide icon per `opportunity_kind`: gig→`Music`, session→`Disc3`, audition→`Mic2`, tour→`Bus`, teaching→`GraduationCap`, collaboration→`Users`, internship→`BookOpen`, job/default→`Briefcase`. Muted `text-slate-300`.
3. `PlayChip.tsx` — `{ sample: PortfolioItem; onOpen(): void }` → pill 32 px high: play triangle + title truncated to 22 chars + provider (from `describeWorkSample`). Click opens the existing `WorkSamplePlayer` in a `Dialog`. If `thumbnail_url` exists, show it as a 24 px square before the title.
4. `EmptyState.tsx` — `{ scene: SceneName; title: string; action?: { label: string; to?: string; onClick?: () => void }; hint?: string }`. Layout: illustration 160×120 centred, title `text-lg font-semibold` (≤ 8 words), optional one-line hint (≤ 14 words), one primary button. Nothing else.
5. `scenes.tsx` — eight inline SVG scenes, 160×120 viewBox, line illustrations in `stroke-violet-300/70` with one `fill-fuchsia-500/20` accent shape, no text: `inbox` (empty envelope tray), `stage` (mic on stand with spotlight), `search` (magnifier over a card), `calendar` (calendar with a tick), `applicants` (three discs, one raised), `portfolio` (three stacked media tiles), `bookmark` (bookmark with a star), `verified` (shield with tick). Export `SceneName`.
6. `StatChips.tsx` — `{ items: { label: string; value: number }[] }` → one row of `text-sm` chips, already used inline in Wave 0; extract it.

Tests: one Vitest file per component (render, a11y label, hash stability). Commit message: "UX wave 1: shared kit". Push to `claude/ux-wave-1`, then write `SHARED_READY` (any content) to `scratchpad/uxaudit/wave1/SHARED_READY` so Track B starts.

## Track A — musician side + public profile/job (branch `claude/ux-wave-1a`)

### A1. Musician dashboard (`JobSeekerDashboard.tsx`)
Order, top to bottom, after `PageHeader` ("Hi, {first}") and the Wave 0 `TourStrip`:
1. **Needs you now** — a row of up to three tiles, only tiles with a non-zero value render; if none, the row is absent:
   - Urgent: amber left border, `Zap` icon, "{n} urgent requests near you" + first item's `roleName · city · {startAt as "Tomorrow 6 pm"}` → button "Respond" → `/jobseeker/urgent`.
   - Messages: `unread = sum(conversations.unreadCount)` (fetch `/api/conversations` once), "{n} unread messages" + latest sender name → "Open" → `/jobseeker/messages`.
   - Interviews: `interviews` count → "{n} interviews scheduled" → "See applications".
   Tile: `min-h-[96px]`, icon 24 px in a 40 px disc, title `font-semibold`, one muted line, button outline (the only gradient button on the page stays "Explore opportunities" in the header).
2. **Good fits** (existing, keep ≥ 60 rule; cards use the new job card, max 3, `md:grid-cols-3`).
3. **Profile nudge** (Wave 0 rule, only < 80).
4. `StatChips` at the bottom.
Empty musician (no urgent, no fits, no messages): render `EmptyState scene="stage"` title "Your first gig starts with your work" action "Add a work sample" → `/jobseeker/library` hint "Hirers hear a sample before they message."

### A2. Job card (`JobCard.tsx`, used by Find work, public jobs, dashboard)
Replace the badge-row + 6-metadata layout with a **row**:
```
[FormatGlyph 24]  Title (font-semibold, 1 line, truncate)          [bookmark]
                  Company · City · Workplace                       ₹25k–55k / project
                  chips: genre, 1 skill max          Closes 14 Nov · 0 applicants (text-xs muted)
```
- Pay is the most prominent secondary element: `text-sm font-semibold text-emerald-200`; "Pay not disclosed" stays muted grey.
- Demo badge (grey outline, Wave 0) goes after the title, never before.
- Card padding `p-4`, height ≤ 96 px desktop; mobile stacks pay under company.
- `compact` prop for the dashboard grid (title + company + pay only).

### A3. Find work (`JobSearch.tsx`)
- Under the search bar, a **sticky filter chip bar** (`sticky top-[72px] z-20`, `bg-slate-950/90 backdrop-blur`): chips for Format (multi), City (single, defaults to profile city), Pay disclosed (toggle), Remote (toggle). Chips drive the existing filter state; the "Filters" drawer stays for the long tail.
- Result count line becomes "453 opportunities · Mumbai · all formats" (reflects active chips).
- List uses the new row card; page size unchanged.

### A4. Public profile (`pages/public/PublicProfile.tsx`) and job details (`PublicOpportunity.tsx`, `JobDetails.tsx`)
Profile hero (first 320 px):
```
[UserAvatar xl]  Name  [Verified]  [Demo]
                 Roles · Genres   ·  City
                 [PlayChip] [PlayChip] [PlayChip]   (first three samples, else "No samples yet")
                                                        ┌ sticky aside (desktop right / mobile bottom bar) ┐
                                                        │ "Book or message"  [Message] [Request a quote]   │
                                                        │ signed-out: "Sign in to hire or message"         │
                                                        └──────────────────────────────────────────────────┘
```
Below: bio (≤ 3 lines, "More" expands), Credits as a compact two-column list, Work samples as a grid of `WorkSampleMediaView` tiles (thumbnail or waveform when present, else provider tile). Remove the "Capabilities" heading; fold its items into a chip row under roles.
Job details hero: `FormatGlyph`, title (`text-3xl`), company link, then a 2×2 fact grid (Pay · Date · City/Workplace · Closes), then a sticky **Apply** (signed-in) / **Sign in to apply** (signed-out) button that stays visible while scrolling (desktop: right aside; mobile: bottom bar). Description and requirements below.

### A5. Empty states (musician)
Applications → `scene="inbox"` "No applications yet" action "Find work"; Saved → `bookmark` "Nothing saved yet" action "Browse opportunities"; Library → `portfolio` "Add your first work sample" action "Add from a link"; Bookings → `calendar` "No bookings yet" hint "Bookings appear here once a hirer confirms"; Messages (no conversations) → `inbox` "No conversations yet" hint "Apply or respond to an urgent request to start one".

## Track B — hirer side + public directory + landing (branch `claude/ux-wave-1b`, from the shared-kit commit)

### B1. Hirer dashboard (`EmployerDashboard.tsx`)
After `PageHeader` ("Hi, {first}", action "Post an opportunity") and `TourStrip`:
1. **New applicants** — if `applications > 0`: a row of up to 5 `UserAvatar md` + names (from `GET /api/employer/applications?limit=5` or the existing applications endpoint; if the list endpoint needs paging params you already have, use them) with one line "{n} applicants across {m} opportunities" and button "Review" → `/employer/applications`. If 0 and there are live jobs: `EmptyState scene="applicants"` "No applicants yet" hint "Most opportunities get their first applicant within 48 hours".
2. **Live opportunities** — existing `OpportunityPipeline` but: the amber "Review note" line becomes a muted `text-xs text-slate-400` with an `Info` icon (colour only when the status is `rejected`); rows show `FormatGlyph` + title + applicants count as a chip; Edit/Close become an overflow menu (`MoreHorizontal`) so each row has one visible control.
3. When no jobs at all: two large choice cards side by side — "Post an opportunity" (`FormatGlyph 'job'` large) and "Need someone by tomorrow?" (`Zap`) — replacing the current single empty box.
4. `StatChips` at the bottom.

### B2. Find talent (`CandidateSearch.tsx`)
Cards → `md:grid-cols-3`:
```
[UserAvatar lg]  Name [Verified]
                 Role · Genres · City
                 [PlayChip first sample]  (or "No samples" muted)
                 chips: up to 3 skills
                 [Message]  [Compare ☐]
```
The right-hand "Select a professional to inspect…" column is removed; the **compare tray** docks to the bottom (`fixed bottom-0`, appears when ≥ 1 selected): avatars of selected + "Compare {n}" button. Bio text is not shown on the card (it is on the profile). Search bar keeps text + city; the three checkboxes become chips.

### B3. Applicants (`EmployerApplications.tsx`)
Card:
```
[UserAvatar md]  Name  [status pill]         [Shortlist / Move to…] [Message]
                 Role · Genres · City · {years} yrs
                 [PlayChip first sample]
                 ▸ Screening answers (n)  — collapsed by default
                 "cover note" italic, 2 lines max, "More"
```
Keep the Wave 0 rules (email hidden until shortlisted; one primary per page). "Rate / note" moves into the "Move to…" menu as its own item.

### B4. Public directory (`PublicTalent.tsx`)
- Header: "Musicians in {city or 'India'}" (`text-3xl`), one line "{n} professionals · verified badges shown where earned". Remove the two-line headline and the sentence under it.
- Filter chips: Role (multi, top 8 roles + "More…" opening the existing select), City, Verified only.
- Cards: `UserAvatar lg`, name + Verified, role · genres, city, one `PlayChip`, ≤ 3 chips; bio removed from the card.

### B5. Landing (`LandingPage.tsx` + `components/landing/*`)
- Delete "Something else? See every way to use Verse" and its link.
- Example card: three text rows → three `PlayChip`s styled exactly like the real ones (static demo data), plus a 6-bar fake waveform strip under the name.
- Under the hero buttons, an **avatar row**: six `UserAvatar sm` with names and city chips from `GET /api/public/professionals?city=Mumbai&limit=6` (or whichever directory endpoint the page already uses); caption "Verified in Mumbai this week". Falls back to nothing if the request fails.
- "How it works": three icons in one row, each ≤ 8 words. No paragraphs.

### B6. Empty states (hirer)
Applicants (no jobs) → `applicants` "Post an opportunity to receive applicants" action "Post"; Bookings → `calendar`; Find talent no results → `search` "No one matches yet" hint "Try fewer filters or another city"; Saved talent → `bookmark`.

## Acceptance (both tracks)
- Re-run `scratchpad/uxaudit/*.mjs`-style measurement on the touched screens (desktop 1440×900, mobile 390×844): words above the fold ≤ 60 (app) / ≤ 90 (public), buttons ≤ 6, ≥ 1 image/illustration/avatar on every content screen, exactly one primary button, no horizontal scroll on mobile. Paste the numbers in the PR body.
- Typecheck, lint 0 warnings, format:check, build, check:bundle (raise `bundle-budget.json` only if the shared kit forces it and say so), check:split, Vitest floors, and every Playwright spec that references changed text (grep before you start; update selectors, never delete assertions). Full mocked Playwright suite before the PR.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01DKVZ7DtE1jj6YgPmVPkvpk`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session URL.
