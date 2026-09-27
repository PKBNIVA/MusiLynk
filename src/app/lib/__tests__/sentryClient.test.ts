import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flush } from './helpers';

const { sdk, scope } = vi.hoisted(() => {
  const scope = { setLevel: vi.fn(), setTags: vi.fn(), setExtras: vi.fn(), setFingerprint: vi.fn() };
  const sdk = {
    init: vi.fn(),
    addIntegration: vi.fn(),
    captureException: vi.fn(() => 'exception-id'),
    captureMessage: vi.fn(() => 'message-id'),
    withScope: vi.fn((callback: (s: typeof scope) => unknown) => callback(scope)),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    flush: vi.fn(() => Promise.resolve(true)),
    metrics: { distribution: vi.fn() },
  };
  return { sdk, scope };
});
vi.mock('@sentry/react', () => sdk);

type SentryClientModule = typeof import('../sentryClient');

async function loadClient(): Promise<SentryClientModule> {
  vi.resetModules();
  return import('../sentryClient');
}

const baseOptions = { dsn: 'https://k@o.ingest/1', release: 'abc', environment: 'production', tracesSampleRate: 0 };

function initOptions() {
  return sdk.init.mock.calls[sdk.init.mock.calls.length - 1][0];
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  for (const fn of [...Object.values(sdk), ...Object.values(scope), sdk.metrics.distribution]) if (typeof fn === 'function') fn.mockClear();
});

describe('initSentry', () => {
  it('starts Sentry privately: no PII, no replay, no tracing by default', async () => {
    const { initSentry } = await loadClient();
    initSentry({ ...baseOptions, release: '' });
    expect(initOptions()).toMatchObject({
      dsn: baseOptions.dsn,
      release: undefined,
      environment: 'production',
      sendDefaultPii: false,
      dataCollection: { userInfo: false },
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    await flush();
    expect(sdk.addIntegration).not.toHaveBeenCalled();
  });

  it('adds browser tracing only when a sample rate is set', async () => {
    const { initSentry } = await loadClient();
    initSentry({ ...baseOptions, tracesSampleRate: 0.2 });
    await vi.waitFor(() => expect(sdk.addIntegration).toHaveBeenCalledWith({ name: 'BrowserTracing' }));
  });

  it('scrubs events and never sends the stored access token', async () => {
    const { initSentry } = await loadClient();
    localStorage.setItem('verse_access_token', 'secret-access-token-value');
    initSentry(baseOptions);
    const event = {
      message: 'Request with secret-access-token-value failed for a@b.co',
      user: { id: 'u1', email: 'a@b.co' },
      request: { cookies: 'x' },
    };
    const sent = initOptions().beforeSend(event, { originalException: new Error('boom') });
    expect(sent).toEqual({ message: 'Request with [Filtered] failed for [email]', user: { id: 'u1' }, request: {} });
  });

  it('drops expected errors and rate-limits sampled ones', async () => {
    const { initSentry } = await loadClient();
    initSentry(baseOptions);
    const { beforeSend } = initOptions();
    const apiError = (status: number) => Object.assign(new Error('x'), { name: 'ApiError', status });

    expect(beforeSend({ message: 'x' }, { originalException: apiError(404) })).toBeNull();
    expect(beforeSend({ message: 'x' }, { originalException: apiError(503) })).not.toBeNull();
    expect(beforeSend({ message: 'x' }, { originalException: apiError(503) })).toBeNull();
    expect(beforeSend({ message: 'x' }, undefined)).not.toBeNull();
  });

  it('scrubs spans and breadcrumbs, even when storage is blocked', async () => {
    const { initSentry } = await loadClient();
    sessionStorage.setItem('verse_access_token', 'legacy-session-token');
    initSentry(baseOptions);
    const { beforeSendSpan, beforeBreadcrumb } = initOptions();

    expect(beforeSendSpan({ description: 'GET /api/me?token=abc', data: { 'http.url': 'x?legacy-session-token' } })).toEqual({
      description: 'GET /api/me?token=[Filtered]',
      data: { 'http.url': 'x?[Filtered]' },
    });

    expect(beforeBreadcrumb({
      message: 'Signed in as a@b.co',
      data: { url: '/auth?code=1', from: '/a', to: '/verify?email=a%40b.co', status_code: 200 },
    })).toEqual({
      message: 'Signed in as [email]',
      data: { url: '/auth?code=[Filtered]', from: '/a', to: '/verify?email=[Filtered]', status_code: 200 },
    });
    expect(beforeBreadcrumb({ category: 'ui.click' })).toEqual({ category: 'ui.click' });

    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError'); } });
    try {
      expect(beforeBreadcrumb({ message: 'still works' })).toEqual({ message: 'still works' });
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('capture helpers', () => {
  it('apply level, tags, extras and fingerprint in a scope', async () => {
    const { captureError, captureText } = await loadClient();
    const error = new Error('x');
    expect(captureError(error, { level: 'warning', tags: { a: 'b' }, extra: { id: 1 }, fingerprint: ['f'] })).toBe('exception-id');
    expect(sdk.captureException).toHaveBeenCalledWith(error);
    expect(scope.setLevel).toHaveBeenCalledWith('warning');
    expect(scope.setTags).toHaveBeenCalledWith({ a: 'b' });
    expect(scope.setExtras).toHaveBeenCalledWith({ id: 1 });
    expect(scope.setFingerprint).toHaveBeenCalledWith(['f']);

    for (const fn of Object.values(scope)) fn.mockClear();
    expect(captureText('hello')).toBe('message-id');
    expect(sdk.captureMessage).toHaveBeenCalledWith('hello');
    expect(scope.setLevel).not.toHaveBeenCalled();

    captureText('partial', { tags: { only: 'tags' } });
    expect(scope.setTags).toHaveBeenCalledWith({ only: 'tags' });
    expect(scope.setLevel).not.toHaveBeenCalled();
  });
});

describe('captureVital', () => {
  it('records a web vital as a distribution metric with route and rating, then flushes', async () => {
    const { captureVital } = await loadClient();
    captureVital({ name: 'LCP', value: 2100, rating: 'good' }, '/professionals/:id');
    expect(sdk.metrics.distribution).toHaveBeenCalledWith('web_vital.lcp', 2100, {
      unit: 'millisecond',
      attributes: { route: '/professionals/:id', rating: 'good' },
    });
    expect(sdk.flush).toHaveBeenCalledWith(2_000);
  });

  it('sends CLS without a unit and ignores a failed flush', async () => {
    const { captureVital } = await loadClient();
    sdk.flush.mockReturnValueOnce(Promise.reject(new Error('offline')));
    captureVital({ name: 'CLS', value: 0.3, rating: 'poor' }, '/');
    await flush();
    expect(sdk.metrics.distribution).toHaveBeenCalledWith('web_vital.cls', 0.3, { unit: 'none', attributes: { route: '/', rating: 'poor' } });
  });
});
