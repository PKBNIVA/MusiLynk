# Self-hosted funnel analytics

No third-party analytics anywhere in MusiLynk. Every event is stored in this app's own
`product_events` table (`db/migrate/20260928163300_create_product_events.rb`) via
`POST /api/events` (`EventsController`), and read back by the admin Funnel tab
(`Admin::FunnelController` / `FunnelQueries`).

## How it works

- **Frontend**: `src/app/lib/analytics.ts` exposes `track(name, props)`. Events queue in memory
  and flush every 5 seconds, or immediately on page hide (`navigator.sendBeacon`, so a flush
  started right before a tab closes still has a chance to land).
- **Backend**: `EventsController#create` accepts a small batch (at most 25 events per request),
  rate-limited per IP (120/minute), each event capped at 1KB once serialized. Only names in
  `EventsController::ALLOWED_NAMES` are ever stored; anything else is dropped without failing the
  rest of the batch. `EventsController#scrub_props` truncates string prop values to 200 characters
  and drops any prop key that looks like it might hold an email address — this app never stores an
  email address or free text in `product_events.props`.
- **Do not track**: `analytics.ts`'s `doNotTrack()` reads a `musilynk_dnt` flag from `localStorage` (named `verse_dnt` before the MusiLynk rename; `legacyStorage.ts` moves old
  `verse_*` keys on first load).
  When set, `track()` is a complete no-op — nothing is queued, nothing is sent. Call
  `setDoNotTrack(true)` to opt a visitor out (e.g. from a cookie/privacy preferences control).
- **Route changes**: `initRouteTracking(router)` is wired once in `src/app/App.tsx` against the
  app's shared data router, and fires a `route_change` event on every navigation automatically —
  `landing_view` specifically for `/`. No page needs to call this itself. A `useRouteTracking()`
  hook does the same thing for a page tree that renders under its own `<Router>`.

## Event names (the full allow-list)

| Event | Fired by | Notes |
|---|---|---|
| `landing_view` | `initRouteTracking` (automatic, path `/`) | Nothing to instrument on the landing page. |
| `route_change` | `initRouteTracking` (automatic, every other path) | `props.path` is the new pathname. |
| `path_chosen` | `trackPathChosen(path)` | Call when the visitor picks hire/musician from the landing page, e.g. `trackPathChosen('hire')`. |
| `signup_started` / `signup_completed` | `trackSignupStep('started' \| 'completed', props?)` | Call at the start and end of the sign-up flow. |
| `profile_link_added` | `trackProfileLinkAdded(kind)` | Call when a profile/social link is added, e.g. `trackProfileLinkAdded('instagram')`. |
| `job_posted` | `trackJobPosted(props?)` | Called from `PostJob.tsx` on a real (non-draft) submit. |
| `urgent_request_submitted` | `trackUrgentRequestSubmitted(props?)` | Called from `UrgentRequests.tsx`. |
| `urgent_response_submitted` | `trackUrgentResponseSubmitted(props?)` | Called from `UrgentRequests.tsx`. |
| `booking_quote_sent` | `trackBookingQuoteSent(props?)` | Called from `Bookings.tsx`. |
| `booking_quote_accepted` | `trackBookingQuoteAccepted(props?)` | Called from `Bookings.tsx`. |
| `booking_deposit_paid` | `trackBookingDepositPaid(props?)` | Called from `BookingDepositPanel.tsx`. |
| `share_clicked` | `ShareMenu` (`components/ShareMenu.tsx`) | `props.surface` (professional, opportunity, act, hirer_opportunity, hirer_opportunity_posted, booking, referral) and `props.channel` (whatsapp, copy, native). Never the shared text or URL. |

## For the agent that owns the landing/signup pages

This task deliberately did not edit the landing page or the sign-up page — instrument them by
importing from `src/app/lib/analytics.ts`:

```ts
import { trackPathChosen, trackSignupStep, trackProfileLinkAdded } from '../lib/analytics';

// On the landing page, when a visitor picks a path:
trackPathChosen('hire'); // or 'musician'

// On the sign-up page:
trackSignupStep('started', { role: 'jobseeker' });
// ...after the account is created:
trackSignupStep('completed', { role: 'jobseeker' });

// Wherever a profile/social link is added (profile setup, portfolio, etc.):
trackProfileLinkAdded('instagram');
```

Never pass an email address, a message body or any other free text as a prop — keep props to
short strings (enums, kinds), numbers and booleans. The server also enforces this, but keep it
true on the client too.

## Admin Funnel tab

`src/app/pages/admin/FunnelTab.tsx` (registered in `AdminDashboard.tsx`) shows, for the last 7 or
30 days:

- the funnel from landing → path chosen → signup completed → first action (job posted or a
  profile link added) → booking or urgent request filled (distinct visitor counts per step);
- weekly bookings and hires;
- median time to first response on urgent requests (from `urgent_requests`/`urgent_request_responses`,
  not from `product_events` — this is exact, not sampled);
- week-1 retention (percent of a week's signups with any event 7-14 days later).

All of it is computed by `FunnelQueries` (plain SQL/ActiveRecord against indexed columns) and
cached for 5 minutes (`Rails.cache`), so opening the tab repeatedly doesn't rescan the events
table.
