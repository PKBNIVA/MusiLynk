import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLocation, flush } from './helpers';

const { sentry, sentryModule } = vi.hoisted(() => {
  const sentry = {
    initSentry: vi.fn(),
    captureError: vi.fn(() => 'event-1'),
    captureText: vi.fn<typeof import('../sentryClient').captureText>(() => 'event-2'),
    captureVital: vi.fn(),
  };
  const sentryModule = () => ({
    initSentry: sentry.initSentry,
    captureError: sentry.captureError,
    captureText: sentry.captureText,
    captureVital: sentry.captureVital,
  });
  return { sentry, sentryModule };
});
vi.mock('../sentryClient', sentryModule);

type MonitoringModule = typeof import('../monitoring');

const DSN = 'https://public@o1.ingest.sentry.io/2';

async function loadMonitoring(env: Record<string, string> = {}): Promise<MonitoringModule> {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import('../monitoring');
}

beforeEach(() => {
  sentry.initSentry.mockReset();
  sentry.captureError.mockReset().mockReturnValue('event-1');
  sentry.captureText.mockReset().mockReturnValue('event-2');
  sentry.captureVital.mockReset();
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    callback();
    return 1;
  });
});

const apiError = (status: number, code?: string) => Object.assign(new Error('x'), { name: 'ApiError', status, code });

describe('classifyError', () => {
  it('ignores aborts, expected 4xx and cancelled uploads', async () => {
    const { classifyError } = await loadMonitoring();
    expect(classifyError(new DOMException('x', 'AbortError'))).toEqual({ action: 'ignore' });
    expect(classifyError(apiError(404, 'NOT_FOUND'))).toEqual({ action: 'ignore' });
    expect(classifyError(apiError(0, 'UPLOAD_CANCELLED'))).toEqual({ action: 'ignore' });
  });

  it('samples server, network and misconfiguration failures by kind', async () => {
    const { classifyError } = await loadMonitoring();
    expect(classifyError(apiError(503))).toEqual({ action: 'sample', key: 'api:503' });
    expect(classifyError(apiError(0, 'NETWORK_ERROR'))).toEqual({ action: 'sample', key: 'api:NETWORK_ERROR' });
    expect(classifyError(apiError(0))).toEqual({ action: 'sample', key: 'api:unknown' });
    expect(classifyError(apiError(200, 'INVALID_RESPONSE'))).toEqual({ action: 'sample', key: 'api:INVALID_RESPONSE' });
  });

  it('reports everything else', async () => {
    const { classifyError } = await loadMonitoring();
    expect(classifyError(new TypeError('x is undefined'))).toEqual({ action: 'report' });
    expect(classifyError('a string')).toEqual({ action: 'report' });
    expect(classifyError(null)).toEqual({ action: 'report' });
    expect(classifyError({ name: 'ApiError', status: '500' })).toEqual({ action: 'report' });
  });
});

describe('allowSampled', () => {
  it('allows one event per kind per five minutes', async () => {
    const { allowSampled } = await loadMonitoring();
    expect(allowSampled('api:503', 0)).toBe(true);
    expect(allowSampled('api:503', 60_000)).toBe(false);
    expect(allowSampled('api:502', 60_000)).toBe(true);
    expect(allowSampled('api:503', 5 * 60_000)).toBe(true);
  });

  it('allows a misconfiguration kind only once per page session', async () => {
    const { allowSampled } = await loadMonitoring();
    expect(allowSampled('api:INVALID_RESPONSE', 0)).toBe(true);
    expect(allowSampled('api:INVALID_RESPONSE', 60 * 60_000)).toBe(false);
  });

  it('caps sampled events per page session', async () => {
    const { allowSampled } = await loadMonitoring();
    const results = Array.from({ length: 7 }, (_, i) => allowSampled(`api:${500 + i}`, 0));
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });
});

describe('without a DSN', () => {
  it('does nothing and never loads the Sentry chunk', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: '' });
    expect(monitoring.monitoringEnabled()).toBe(false);
    monitoring.initMonitoring();
    monitoring.reportError(new Error('x'));
    monitoring.reportMessage('x');
    monitoring.reportApiFailure({ status: 500, method: 'GET', path: '/x' });
    expect(await monitoring.whenMonitoringReady()).toBe(false);
    expect(await monitoring.sendClientTestError()).toBeNull();
    expect(monitoring.monitoringReady()).toBe(false);
    expect(sentry.initSentry).not.toHaveBeenCalled();
  });
});

describe('with a DSN', () => {
  it('queues early reports and flushes them once Sentry loads', async () => {
    const monitoring = await loadMonitoring({
      VITE_SENTRY_DSN: ` ${DSN} `,
      VITE_RELEASE: 'abc123',
      VITE_SENTRY_ENVIRONMENT: 'staging',
      VITE_SENTRY_TRACES_SAMPLE_RATE: '5',
    });
    expect(monitoring.monitoringEnabled()).toBe(true);
    const early = new Error('before load');
    monitoring.reportError(early, { tags: { a: 'b' } });
    monitoring.reportMessage('hello');

    expect(await monitoring.whenMonitoringReady()).toBe(true);
    expect(monitoring.monitoringReady()).toBe(true);
    expect(sentry.initSentry).toHaveBeenCalledWith({
      dsn: DSN,
      release: 'abc123',
      environment: 'staging',
      tracesSampleRate: 1,
    });
    expect(sentry.captureError).toHaveBeenCalledWith(early, { tags: { a: 'b' } });
    expect(sentry.captureText).toHaveBeenCalledWith('hello', undefined);

    monitoring.reportError('later');
    monitoring.reportMessage('later message', { level: 'info' });
    expect(sentry.captureError).toHaveBeenLastCalledWith('later', undefined);
    expect(sentry.captureText).toHaveBeenLastCalledWith('later message', { level: 'info' });
  });

  it('caps the pre-load queue at twenty items', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    for (let i = 0; i < 25; i += 1) monitoring.reportMessage(`m${i}`);
    await monitoring.whenMonitoringReady();
    expect(sentry.captureText).toHaveBeenCalledTimes(20);
  });

  it('captures uncaught errors and rejections before Sentry takes over', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    // Marks the dispatched test errors as handled so jsdom does not rethrow them.
    const handled = (event: Event) => event.preventDefault();
    window.addEventListener('error', handled);
    try {
      const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
      monitoring.initMonitoring();
      monitoring.initMonitoring(); // idempotent
      const boom = new Error('boom');
      window.dispatchEvent(new ErrorEvent('error', { error: boom, message: 'boom' }));
      window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
      const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
      Object.defineProperty(rejection, 'reason', { value: 'nope' });
      window.dispatchEvent(rejection);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(await monitoring.whenMonitoringReady()).toBe(true);
      expect(sentry.captureError.mock.calls).toEqual([
        [boom, { tags: { source: 'window.onerror' } }],
        ['Script error.', { tags: { source: 'window.onerror' } }],
        ['nope', { tags: { source: 'unhandledrejection' } }],
      ]);

      // Sentry's own handlers own global errors from here on.
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('after') }));
      expect(sentry.captureError).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener('error', handled);
      vi.useRealTimers();
    }
  });

  it('drops queued reports when the Sentry chunk fails to load', async () => {
    vi.doMock('../sentryClient', () => {
      throw new Error('chunk failed to load');
    });
    try {
      const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
      monitoring.reportMessage('queued');
      expect(await monitoring.whenMonitoringReady()).toBe(false);
      expect(monitoring.monitoringReady()).toBe(false);
      expect(await monitoring.sendClientTestError()).toBeNull();
      monitoring.reportMessage('still not sent');
      expect(sentry.captureText).not.toHaveBeenCalled();
    } finally {
      vi.doMock('../sentryClient', sentryModule);
    }
  });

  it('sends a tagged admin test error and returns its id', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    expect(await monitoring.sendClientTestError()).toBe('event-1');
    expect(sentry.captureError).toHaveBeenCalledWith(expect.any(Error), {
      tags: { source: 'admin_sentry_test', musilynk_test: 'true' },
    });
    sentry.captureError.mockReturnValue('');
    expect(await monitoring.sendClientTestError()).toBeNull();
  });
});

describe('reportApiFailure', () => {
  it('reports a 5xx once per window with a normalised route', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    await monitoring.whenMonitoringReady();

    monitoring.reportApiFailure({
      status: 503,
      code: 'UNAVAILABLE',
      method: 'GET',
      path: '/jobs/42/applications/0f8fad5b-d9cb-469f-a165-70867728950e?page=2',
      requestId: 'req-1',
    });
    monitoring.reportApiFailure({ status: 503, method: 'GET', path: '/jobs/43' });

    expect(sentry.captureText).toHaveBeenCalledTimes(1);
    expect(sentry.captureText).toHaveBeenCalledWith('API GET /jobs/:id/applications/:id failed (503)', {
      level: 'warning',
      tags: { source: 'api', apiStatus: '503', apiCode: 'UNAVAILABLE' },
      extra: { requestId: 'req-1' },
      fingerprint: ['api-failure', '503', 'GET', '/jobs/:id/applications/:id'],
    });
  });

  it('skips expected 4xx and offline devices, but reports a non-JSON success', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    await monitoring.whenMonitoringReady();

    monitoring.reportApiFailure({ status: 404, method: 'GET', path: '/x' });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    monitoring.reportApiFailure({ status: 0, code: 'NETWORK_ERROR', method: 'GET', path: '/x' });
    onLine.mockRestore();
    expect(sentry.captureText).not.toHaveBeenCalled();

    monitoring.reportApiFailure({ status: 0, code: 'NETWORK_ERROR', method: 'POST', path: '/x' });
    monitoring.reportApiFailure({ status: 200, code: 'INVALID_RESPONSE', method: 'GET', path: '/me' });
    monitoring.reportApiFailure({ status: 200, code: 'INVALID_RESPONSE', method: 'GET', path: '/me' });
    monitoring.reportApiFailure({ status: 0, method: 'GET', path: '/y' });
    expect(sentry.captureText.mock.calls.map((call) => call[0])).toEqual([
      'API POST /x failed (NETWORK_ERROR)',
      'API GET /me failed (INVALID_RESPONSE)',
      'API GET /y failed (unknown)',
    ]);
    expect(sentry.captureText.mock.calls[2]?.[1]?.tags?.apiCode).toBe('none');
  });

  it('flushes a report queued before load', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    monitoring.reportApiFailure({ status: 500, method: 'PATCH', path: '/profile' });
    await flush();
    await monitoring.whenMonitoringReady();
    expect(sentry.captureText).toHaveBeenCalledWith('API PATCH /profile failed (500)', expect.any(Object));
  });
});

describe('tracesSampleRate', () => {
  it('defaults to a small sample, honours an explicit rate and clamps it', async () => {
    const { tracesSampleRate, DEFAULT_TRACES_SAMPLE_RATE } = await loadMonitoring();
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeGreaterThan(0);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(0.1);
    expect(tracesSampleRate(undefined)).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(tracesSampleRate(' ')).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(tracesSampleRate('lots')).toBe(DEFAULT_TRACES_SAMPLE_RATE);
    expect(tracesSampleRate('0')).toBe(0);
    expect(tracesSampleRate('0.5')).toBe(0.5);
    expect(tracesSampleRate('-1')).toBe(0);
    expect(tracesSampleRate('9')).toBe(1);
  });

  it('is used for Sentry when no rate is configured', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    await monitoring.whenMonitoringReady();
    expect(sentry.initSentry).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: monitoring.DEFAULT_TRACES_SAMPLE_RATE }),
    );
  });
});

describe('routeTemplate', () => {
  it('replaces ids and slugs and keeps at most three segments', async () => {
    const { routeTemplate } = await loadMonitoring();
    expect(routeTemplate('/')).toBe('/');
    expect(routeTemplate('/professionals/jane-doe')).toBe('/professionals/:id');
    expect(routeTemplate('/employer/jobs/42?tab=applicants#top')).toBe('/employer/jobs/:id');
    expect(routeTemplate('/opportunities/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('/opportunities/:id');
    expect(routeTemplate('/auth/employer')).toBe('/auth/:id');
    expect(routeTemplate('/jobseeker/messages/extra/deep')).toBe('/jobseeker/messages/extra');
    expect(routeTemplate('/users/7')).toBe('/users/:id');
  });
});

describe('reportWebVital', () => {
  const lcp = { name: 'LCP' as const, value: 1800, rating: 'good' as const };

  it('does nothing without a DSN', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: '' });
    monitoring.reportWebVital(lcp, '/pricing');
    monitoring.reportWebVital(lcp);
    expect(sentry.captureVital).not.toHaveBeenCalled();
  });

  it('queues vitals before Sentry loads and sends them with the route template', async () => {
    const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
    monitoring.reportWebVital(lcp, '/professionals/jane-doe');
    expect(sentry.captureVital).not.toHaveBeenCalled();
    await monitoring.whenMonitoringReady();
    expect(sentry.captureVital).toHaveBeenCalledWith(lcp, '/professionals/:id');

    const { location, restore } = fakeLocation('/acts/12');
    try {
      monitoring.reportWebVital({ name: 'CLS', value: 0.02, rating: 'good' });
    } finally {
      restore();
    }
    expect(sentry.captureVital).toHaveBeenLastCalledWith({ name: 'CLS', value: 0.02, rating: 'good' }, '/acts/:id');
    expect(location.pathname).toBe('/acts/12');
  });

  it('starts measuring when monitoring starts and reports when the page is hidden', async () => {
    const observers: Array<{ type: string; callback: (list: { getEntries: () => unknown[] }) => void }> = [];
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = ['largest-contentful-paint'];
        type = '';
        constructor(public callback: (list: { getEntries: () => unknown[] }) => void) {
          observers.push(this as never);
        }
        observe(options: { type: string }) {
          this.type = options.type;
        }
        disconnect() {}
      },
    );
    const { restore } = fakeLocation('/pricing');
    try {
      const monitoring = await loadMonitoring({ VITE_SENTRY_DSN: DSN });
      monitoring.initMonitoring();
      await monitoring.whenMonitoringReady();
      observers[0].callback({ getEntries: () => [{ startTime: 950 }] });
      window.dispatchEvent(new Event('pagehide'));
      expect(sentry.captureVital).toHaveBeenCalledWith({ name: 'LCP', value: 950, rating: 'good' }, '/pricing');
    } finally {
      restore();
    }
  });
});
