// Self-hosted funnel analytics. No third-party analytics: every event goes to Verse's own
// POST /api/events (EventsController), which only stores allow-listed event names.
//
// track(name, props) queues an event and flushes the queue every FLUSH_INTERVAL_MS or when the
// page is hidden (via navigator.sendBeacon, so an event fired right before a tab closes still
// sends). A "do not track" flag in localStorage turns this off completely: nothing is queued,
// nothing is sent, and the queue already held is dropped.
//
// This module never sends an email address or free text: keep prop values to short strings,
// numbers, booleans and enums (the server also enforces this, but keep it true here too).

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { API_BASE } from './api';

export type EventProps = Record<string, string | number | boolean | null | undefined>;

/** Every event name this app is allowed to send (kept in step with backend/docs/analytics.md
 * and EventsController::ALLOWED_NAMES on the server, which is the actual enforcement point). */
export const EVENT_NAMES = [
  'landing_view',
  'path_chosen',
  'signup_started',
  'signup_completed',
  'profile_link_added',
  'job_posted',
  'urgent_request_submitted',
  'urgent_response_submitted',
  'booking_quote_sent',
  'booking_quote_accepted',
  'booking_deposit_paid',
  'route_change',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const DNT_KEY = 'verse_dnt';
const ANON_ID_KEY = 'verse_anon_id';
const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE = 25;

type QueuedEvent = {
  name: EventName;
  anonId: string;
  props: EventProps;
  page: string;
  referrer: string;
};

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let anonIdCache: string | null = null;

/** True when the visitor has opted out via the "do not track" localStorage flag. Reading or
 * writing storage can throw (private browsing, blocked site data); either way this fails safe
 * by treating tracking as off. */
export function doNotTrack(): boolean {
  try {
    return localStorage.getItem(DNT_KEY) === '1';
  } catch {
    return true;
  }
}

export function setDoNotTrack(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(DNT_KEY, '1');
      queue = [];
    } else {
      localStorage.removeItem(DNT_KEY);
    }
  } catch {
    /* best effort only */
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through to the weaker generator below */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A stable per-browser id, never tied to an account. Persisted in localStorage; regenerated
 * (and not persisted) when storage is unavailable, so tracking degrades to per-page-load only. */
function anonId(): string {
  if (anonIdCache) return anonIdCache;
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) {
      anonIdCache = existing;
      return existing;
    }
    const created = randomId();
    localStorage.setItem(ANON_ID_KEY, created);
    anonIdCache = created;
    return created;
  } catch {
    anonIdCache = randomId();
    return anonIdCache;
  }
}

// Never an email or free text, matching the server's own scrub (EventsController#scrub_props):
// values are truncated, and any key that looks like it might hold an email is dropped.
const EMAIL_LIKE = /email|@/i;
function scrubProps(props?: EventProps): EventProps {
  if (!props) return {};
  const out: EventProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (!key || key.length > 60 || EMAIL_LIKE.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('verse_access_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Queues an event for the next flush. Silently a no-op when tracking is off or the name isn't
 * recognized — callers never need to check either condition themselves. */
export function track(name: EventName, props?: EventProps): void {
  if (doNotTrack() || !EVENT_NAMES.includes(name)) return;
  if (typeof window === 'undefined') return;

  queue.push({
    name,
    anonId: anonId(),
    props: scrubProps(props),
    page: window.location?.pathname || '',
    referrer: (typeof document !== 'undefined' && document.referrer) || '',
  });
  if (queue.length >= MAX_QUEUE) flush();
  ensureTimer();
}

function ensureTimer(): void {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
}

/** Sends whatever is queued right now. Uses fetch with keepalive so a flush started just before
 * navigation still has a chance to complete; useBeacon forces navigator.sendBeacon instead
 * (used on page hide, when a fetch could be cancelled by the browser). */
export function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  const body = JSON.stringify({ events });

  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(`${API_BASE}/events`, new Blob([body], { type: 'application/json' }));
    if (sent) return;
    // sendBeacon can refuse (payload too large, browser policy); fall through to fetch below.
  }
  if (typeof fetch !== 'function') return;
  fetch(`${API_BASE}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body,
    keepalive: true,
  }).catch(() => {
    /* fire-and-forget: analytics never surfaces an error to the visitor */
  });
}

let hideListenerAttached = false;
function attachHideListener(): void {
  if (hideListenerAttached || typeof document === 'undefined') return;
  hideListenerAttached = true;
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush(true);
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => flush(true));
}
attachHideListener();

// ---------------------------------------------------------------------------------------------
// Named helpers. Pages this task owns (PostJob, urgent request pages, booking pages) call these
// directly. The landing and signup pages are owned by another agent — they call
// trackPathChosen / trackSignupStep instead of importing `track` themselves. Documented in
// backend/docs/analytics.md.

/** Landing page view. Fired automatically by the route-change hook below when the path is "/",
 * so the landing page itself never needs to import this module. */
export function trackLandingView(): void {
  track('landing_view');
}

/** Call when the visitor picks a path from the landing page, e.g. trackPathChosen('hire') or
 * trackPathChosen('musician'). */
export function trackPathChosen(path: string): void {
  track('path_chosen', { path });
}

/** Call at the start and end of the sign-up flow: trackSignupStep('started', { role }) and
 * trackSignupStep('completed', { role }). */
export function trackSignupStep(step: 'started' | 'completed', props?: EventProps): void {
  track(step === 'started' ? 'signup_started' : 'signup_completed', props);
}

export function trackProfileLinkAdded(kind: string): void {
  track('profile_link_added', { kind });
}

export function trackJobPosted(props?: EventProps): void {
  track('job_posted', props);
}

export function trackUrgentRequestSubmitted(props?: EventProps): void {
  track('urgent_request_submitted', props);
}

export function trackUrgentResponseSubmitted(props?: EventProps): void {
  track('urgent_response_submitted', props);
}

export function trackBookingQuoteSent(props?: EventProps): void {
  track('booking_quote_sent', props);
}

export function trackBookingQuoteAccepted(props?: EventProps): void {
  track('booking_quote_accepted', props);
}

export function trackBookingDepositPaid(props?: EventProps): void {
  track('booking_deposit_paid', props);
}

// ---------------------------------------------------------------------------------------------
// Route-change tracking. `initRouteTracking` is called once from App.tsx with the app's data
// router, and needs no further wiring on any page. `useRouteTracking` is the same logic as a
// React hook, for a page tree that renders under its own <Router> (e.g. a standalone preview) and
// doesn't go through the app's shared router instance.

type MinimalRouter = { subscribe: (listener: (state: { location: { pathname: string } }) => void) => () => void };
let routeTrackingInitialized = false;

/** Wires automatic `route_change` (and `landing_view` for "/") tracking to the app's router.
 * Safe to call more than once; only the first call attaches a listener. */
export function initRouteTracking(router: MinimalRouter): void {
  if (routeTrackingInitialized) return;
  routeTrackingInitialized = true;
  let lastPath: string | null = null;
  router.subscribe((state) => {
    const path = state.location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    if (path === '/') trackLandingView();
    else track('route_change', { path });
  });
}

/** Same tracking as `initRouteTracking`, as a React hook for a page tree that renders under its
 * own <Router> rather than the app's shared data router. Not used by the app shell itself (see
 * initRouteTracking), but available for a standalone preview or a future router. */
export function useRouteTracking(): void {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const path = location.pathname;
    if (path === lastPath.current) return;
    lastPath.current = path;
    if (path === '/') trackLandingView();
    else track('route_change', { path });
  }, [location.pathname]);
}
