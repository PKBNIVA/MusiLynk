import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AnalyticsModule = typeof import('../analytics');

async function load(): Promise<AnalyticsModule> {
  vi.resetModules();
  return import('../analytics');
}

let fetchMock: ReturnType<typeof vi.fn>;
let beaconMock: ReturnType<typeof vi.fn> | undefined;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  beaconMock = undefined;
  // jsdom does not implement sendBeacon; tests that need it stub it explicitly.
  // @ts-expect-error -- jsdom's Navigator has no sendBeacon
  delete navigator.sendBeacon;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function lastBody(): { events: Array<Record<string, unknown>> } {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse(call![1].body as string);
}

describe('doNotTrack / setDoNotTrack', () => {
  it('is off by default and persists once set', async () => {
    const a = await load();
    expect(a.doNotTrack()).toBe(false);
    a.setDoNotTrack(true);
    expect(a.doNotTrack()).toBe(true);
    a.setDoNotTrack(false);
    expect(a.doNotTrack()).toBe(false);
  });

  it('fails safe (treated as on) when localStorage throws', async () => {
    const a = await load();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(a.doNotTrack()).toBe(true);
  });
});

describe('track / flush', () => {
  it('does nothing when do-not-track is on', async () => {
    const a = await load();
    a.setDoNotTrack(true);
    a.track('job_posted');
    a.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an event name outside the allow-list', async () => {
    const a = await load();
    // @ts-expect-error -- deliberately an unlisted name
    a.track('made_up_event');
    a.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queues and flushes an event with the page and referrer attached', async () => {
    const a = await load();
    a.track('job_posted', { city: 'Pune' });
    a.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/events');
    expect(opts.method).toBe('POST');
    const body = lastBody();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ name: 'job_posted', props: { city: 'Pune' } });
    expect(typeof body.events[0]!.anonId).toBe('string');
  });

  it('does nothing on an empty queue', async () => {
    const a = await load();
    a.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scrubs email-like keys and truncates long strings, keeps numbers and booleans', async () => {
    const a = await load();
    a.track('job_posted', { email: 'person@example.com', title: 'x'.repeat(300), count: 3, ok: true });
    a.flush();
    const props = lastBody().events[0]!.props as Record<string, unknown>;
    expect(props.email).toBeUndefined();
    expect((props.title as string).length).toBe(200);
    expect(props.count).toBe(3);
    expect(props.ok).toBe(true);
  });

  it('reuses the same anon id across events and persists it in localStorage', async () => {
    const a = await load();
    a.track('job_posted');
    a.track('booking_quote_sent');
    a.flush();
    const [first, second] = lastBody().events;
    expect(first!.anonId).toBe(second!.anonId);
    expect(localStorage.getItem('musilynk_anon_id')).toBe(first!.anonId);
  });

  it('reuses an anon id already persisted in localStorage from a previous visit', async () => {
    localStorage.setItem('musilynk_anon_id', 'existing-anon-id');
    const a = await load();
    a.track('job_posted');
    a.flush();
    expect(lastBody().events[0]!.anonId).toBe('existing-anon-id');
  });

  it('falls back to a non-crypto id when crypto.randomUUID is unavailable', async () => {
    localStorage.clear();
    vi.stubGlobal('crypto', {});
    const a = await load();
    a.track('job_posted');
    a.flush();
    expect(typeof lastBody().events[0]!.anonId).toBe('string');
  });

  it('sends without an Authorization header when reading the token throws', async () => {
    const a = await load();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'musilynk_access_token') throw new Error('blocked');
      return null;
    });
    a.track('job_posted');
    a.flush();
    const [, opts] = fetchMock.mock.calls[0]!;
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('generates a fresh (unpersisted) anon id when localStorage is unavailable', async () => {
    const a = await load();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'musilynk_anon_id') throw new Error('blocked');
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === 'musilynk_anon_id') throw new Error('blocked');
    });
    a.track('job_posted');
    a.flush();
    expect(typeof lastBody().events[0]!.anonId).toBe('string');
  });

  it('flushes automatically once the queue reaches its cap', async () => {
    const a = await load();
    for (let i = 0; i < 25; i += 1) a.track('job_posted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events).toHaveLength(25);
  });

  it("includes the signed-in user's bearer token when present", async () => {
    localStorage.setItem('musilynk_access_token', 'test-token');
    const a = await load();
    a.track('job_posted');
    a.flush();
    const [, opts] = fetchMock.mock.calls[0]!;
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('sends via sendBeacon on page hide, falling back to fetch when it refuses', async () => {
    const a = await load();
    beaconMock = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconMock });
    a.track('job_posted');
    a.flush(true);
    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    beaconMock = vi.fn(() => false);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconMock });
    a.track('job_posted');
    a.flush(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flushes on a timer and on visibilitychange/pagehide', async () => {
    vi.useFakeTimers();
    const a = await load();
    a.track('job_posted');
    vi.advanceTimersByTime(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    a.track('booking_quote_sent');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    a.track('booking_deposit_paid');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('named helpers', () => {
  it('each helper tracks its documented event name', async () => {
    const a = await load();
    a.trackPathChosen('hire');
    a.trackSignupStep('started', { role: 'jobseeker' });
    a.trackSignupStep('completed', { role: 'jobseeker' });
    a.trackProfileLinkAdded('instagram');
    a.trackJobPosted();
    a.trackUrgentRequestSubmitted();
    a.trackUrgentResponseSubmitted();
    a.trackBookingQuoteSent();
    a.trackBookingQuoteAccepted();
    a.trackBookingDepositPaid();
    a.flush();
    const names = lastBody().events.map((e) => e.name);
    expect(names).toEqual([
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
    ]);
  });
});

describe('initRouteTracking', () => {
  it('fires landing_view for "/" and route_change for everything else, once per path', async () => {
    const a = await load();
    const listeners: Array<(state: { location: { pathname: string } }) => void> = [];
    const fakeRouter = {
      subscribe: (fn: (state: { location: { pathname: string } }) => void) => (listeners.push(fn), () => undefined),
    };
    a.initRouteTracking(fakeRouter);
    listeners[0]!({ location: { pathname: '/' } });
    listeners[0]!({ location: { pathname: '/jobs' } });
    listeners[0]!({ location: { pathname: '/jobs' } }); // same path again: no duplicate event
    a.flush();
    const events = lastBody().events;
    expect(events.map((e) => e.name)).toEqual(['landing_view', 'route_change']);
    expect(events[1]!.props).toMatchObject({ path: '/jobs' });
  });

  it('records the page the router is already on, once, when started late', async () => {
    const a = await load();
    const listeners: Array<(state: { location: { pathname: string } }) => void> = [];
    a.initRouteTracking({
      subscribe: (fn: (state: { location: { pathname: string } }) => void) => (listeners.push(fn), () => undefined),
      state: { location: { pathname: '/search' } },
    });
    listeners[0]!({ location: { pathname: '/search' } }); // the router confirming the same page: no duplicate
    listeners[0]!({ location: { pathname: '/' } });
    a.flush();
    const events = lastBody().events;
    expect(events.map((e) => e.name)).toEqual(['route_change', 'landing_view']);
    expect(events[0]!.props).toMatchObject({ path: '/search' });
  });

  it('only attaches once even if called twice', async () => {
    const a = await load();
    let subscribed = 0;
    a.initRouteTracking({ subscribe: () => ((subscribed += 1), () => undefined) });
    a.initRouteTracking({ subscribe: () => ((subscribed += 1), () => undefined) });
    expect(subscribed).toBe(1);
  });
});

describe('useRouteTracking', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('tracks the initial route and subsequent navigations', async () => {
    const a = await load();

    function Harness() {
      a.useRouteTracking();
      return null;
    }
    const router = createMemoryRouter(
      [
        { path: '/', element: <Harness /> },
        { path: '/jobs', element: <Harness /> },
      ],
      { initialEntries: ['/jobs'] },
    );
    act(() => root.render(<RouterProvider router={router} />));
    await act(async () => {
      await router.navigate('/');
    });
    a.flush();
    const names = lastBody().events.map((e) => e.name);
    expect(names).toEqual(['route_change', 'landing_view']);
  });
});

describe('redactTrackedPath', () => {
  it('replaces the invite token and drops query strings and fragments', async () => {
    const a = await load();
    expect(a.redactTrackedPath('/invites/SECRETtoken_123-abc')).toBe('/invites/:token');
    expect(a.redactTrackedPath('/invites/abc?x=1#y')).toBe('/invites/:token');
    expect(a.redactTrackedPath('/reset-password?token=abc')).toBe('/reset-password');
    expect(a.redactTrackedPath('/verify-email?t=abc#frag')).toBe('/verify-email');
    expect(a.redactTrackedPath('/acts/act_1')).toBe('/acts/act_1');
    expect(a.redactTrackedPath('/')).toBe('/');
  });

  it('never queues an invite token as the page or a path prop', async () => {
    window.history.pushState({}, '', '/invites/TOPSECRET');
    const a = await load();
    a.track('route_change', { path: '/invites/TOPSECRET?x=1', other: 'see /invites/TOPSECRET' });
    a.flush();
    const event = lastBody().events[0]!;
    expect(JSON.stringify(event)).not.toContain('TOPSECRET');
    expect(event.page).toBe('/invites/:token');
    expect(event.props).toMatchObject({ path: '/invites/:token' });
    window.history.pushState({}, '', '/');
  });
});
