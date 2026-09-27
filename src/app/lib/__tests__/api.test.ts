import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockStorage, fakeLocation, jsonResponse } from './helpers';

const { reportApiFailure } = vi.hoisted(() => ({ reportApiFailure: vi.fn() }));
vi.mock('../monitoring', () => ({ reportApiFailure }));

type ApiModule = typeof import('../api');

// api.ts keeps per-page state (in-memory token copy, redirect latch), so every test
// gets a fresh copy of the module.
async function loadApi(): Promise<ApiModule> {
  vi.resetModules();
  return import('../api');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reportApiFailure.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: url as string, init: init as RequestInit & { headers: Headers } };
}

describe('api() requests', () => {
  it('sends the bearer token, JSON body and omits cookies', async () => {
    const { apiPost, setAccessToken } = await loadApi();
    setAccessToken('tok-123');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await expect(apiPost('/jobs', { title: 'Session drummer' })).resolves.toEqual({ ok: true });

    const { url, init } = lastRequest();
    expect(url).toBe('/api/jobs');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.body).toBe(JSON.stringify({ title: 'Session drummer' }));
    expect(init.headers.get('Authorization')).toBe('Bearer tok-123');
    expect(init.headers.get('Content-Type')).toBe('application/json');
  });

  it('sends no Authorization header when signed out and no Content-Type for FormData', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({}));

    await api('/uploads', { method: 'post', body: new FormData() });

    const { init } = lastRequest();
    expect(init.method).toBe('POST');
    expect(init.headers.has('Authorization')).toBe(false);
    expect(init.headers.has('Content-Type')).toBe(false);
  });

  it('uses the right verb for each helper', async () => {
    const { apiGet, apiPut, apiPatch, apiDelete, apiPost } = await loadApi();
    fetchMock.mockImplementation(async () => jsonResponse({}));

    await apiGet('/a');
    expect(lastRequest().init.method).toBe('GET');
    await apiPut('/a', { x: 1 });
    expect(lastRequest().init).toMatchObject({ method: 'PUT', body: '{"x":1}' });
    await apiPatch('/a');
    expect(lastRequest().init).toMatchObject({ method: 'PATCH', body: '{}' });
    await apiPost('/a');
    expect(lastRequest().init).toMatchObject({ method: 'POST', body: '{}' });
    await apiDelete('/a');
    expect(lastRequest().init.method).toBe('DELETE');
  });

  it('returns undefined for 204 No Content', async () => {
    const { apiDelete } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse(null, 204));
    await expect(apiDelete('/saved-searches/1')).resolves.toBeUndefined();
  });

  it('exposes the email sign-in code endpoints', async () => {
    const { requestSignInCode, getSignInMethods } = await loadApi();
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));

    await requestSignInCode({ email: 'a@b.co', role: 'employer' });
    expect(lastRequest().url).toBe('/api/auth/otp/request');
    expect(JSON.parse(lastRequest().init.body as string)).toEqual({ email: 'a@b.co', role: 'employer' });

    await getSignInMethods();
    expect(lastRequest()).toMatchObject({ url: '/api/auth/methods', init: { method: 'GET' } });
  });
});

describe('api() error mapping', () => {
  it('maps a 4xx JSON error to ApiError with code and request id, without reporting it', async () => {
    const { api, ApiError } = await loadApi();
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Title is required', code: 'VALIDATION' }, 422, { 'x-request-id': 'req-9' }),
    );

    const error = await api('/jobs', { method: 'POST', body: '{}' }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      message: 'Title is required',
      status: 422,
      code: 'VALIDATION',
      requestId: 'req-9',
    });
    expect(reportApiFailure).not.toHaveBeenCalled();
  });

  it('falls back to a generic message and a body request id', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ request_id: 'body-id' }, 409));
    await expect(api('/x', { method: 'POST' })).rejects.toMatchObject({
      message: 'Request failed (409)',
      requestId: 'body-id',
    });
  });

  it('reports 5xx failures', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Boom', code: 'INTERNAL', requestId: 'r1' }, 500));

    await expect(api('/jobs/12', { method: 'DELETE' })).rejects.toMatchObject({ status: 500, message: 'Boom' });
    expect(reportApiFailure).toHaveBeenCalledWith({
      status: 500,
      code: 'INTERNAL',
      method: 'DELETE',
      path: '/jobs/12',
      requestId: 'r1',
    });
  });

  it('treats a non-JSON success (SPA served for /api) as INVALID_RESPONSE', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(
      new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    await expect(api('/me')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    expect(reportApiFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INVALID_RESPONSE', path: '/me', method: 'GET' }),
    );
  });

  it('treats malformed JSON on success as INVALID_RESPONSE', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(api('/me')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps a non-JSON error body to a generic message', async () => {
    const { api } = await loadApi();
    fetchMock.mockResolvedValue(
      new Response('Bad gateway', { status: 400, headers: { 'content-type': 'text/plain' } }),
    );
    await expect(api('/x', { method: 'POST' })).rejects.toMatchObject({ status: 400, message: 'Request failed (400)' });
  });

  it('announces server plan limits (402) for the upgrade prompt', async () => {
    const { api, PLAN_LIMIT_EVENT } = await loadApi();
    const listener = vi.fn();
    window.addEventListener(PLAN_LIMIT_EVENT, listener);
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Upgrade to post more jobs', code: 'PLAN_LIMIT_REACHED' }, 402));

    await expect(api('/jobs', { method: 'POST' })).rejects.toMatchObject({ status: 402 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ message: 'Upgrade to post more jobs' });
    window.removeEventListener(PLAN_LIMIT_EVENT, listener);
  });

  it('does not announce other 402s', async () => {
    const { api, PLAN_LIMIT_EVENT } = await loadApi();
    const listener = vi.fn();
    window.addEventListener(PLAN_LIMIT_EVENT, listener);
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Payment required', code: 'PAYMENT' }, 402));
    await expect(api('/x', { method: 'POST' })).rejects.toMatchObject({ status: 402 });
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(PLAN_LIMIT_EVENT, listener);
  });

  it('maps a failed POST to NETWORK_ERROR without retrying', async () => {
    const { apiPost } = await loadApi();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiPost('/messages', { body: 'hi' })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportApiFailure).toHaveBeenCalledWith({
      status: 0,
      code: 'NETWORK_ERROR',
      method: 'POST',
      path: '/messages',
    });
  });

  it('maps a raw AbortError from fetch to REQUEST_TIMEOUT', async () => {
    const { apiPost } = await loadApi();
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(apiPost('/x')).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out. Please try again.',
    });
  });
});

describe('api() retries and deadlines', () => {
  it('retries a GET once after a 503, honouring Retry-After seconds', async () => {
    vi.useFakeTimers();
    const { apiGet } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }));

    const result = apiGet('/jobs');
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ jobs: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportApiFailure).not.toHaveBeenCalled();
  });

  it('accepts an HTTP-date Retry-After and caps the wait at two seconds', async () => {
    vi.useFakeTimers();
    const { apiGet } = await loadApi();
    const later = new Date(Date.now() + 60_000).toUTCString();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': later }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));

    const result = apiGet('/search');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).resolves.toEqual({ ok: 1 });
  });

  it('ignores an unparseable Retry-After and uses a short jittered delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { apiGet } = await loadApi();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 502, { 'retry-after': 'soon-ish' }))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));

    const result = apiGet('/search');
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ ok: 1 });
  });

  it('gives up after one retry and reports the final 503', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { apiGet } = await loadApi();
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'down' }, 503));

    const result = apiGet('/jobs').catch((e) => e);
    await vi.advanceTimersByTimeAsync(500);

    expect(await result).toMatchObject({ status: 503, message: 'down' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportApiFailure).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the deadline leaves no room for another attempt', async () => {
    vi.useFakeTimers();
    const { apiGet } = await loadApi();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'busy' }, 503, { 'retry-after': '2' }));

    await expect(apiGet('/jobs', { timeoutMs: 1_000 })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET once after a network error', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { apiGet } = await loadApi();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = apiGet('/me');
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ ok: true });
  });

  it('turns a hung request into REQUEST_TIMEOUT at the deadline', async () => {
    vi.useFakeTimers();
    const { apiPost } = await loadApi();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );

    const result = apiPost('/slow', {}, { timeoutMs: 5_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await result).toMatchObject({ name: 'ApiError', code: 'REQUEST_TIMEOUT', status: 0 });
    expect(reportApiFailure).toHaveBeenCalledWith({
      status: 0,
      code: 'REQUEST_TIMEOUT',
      method: 'POST',
      path: '/slow',
    });
  });

  it('rethrows the caller abort unchanged and reports nothing', async () => {
    const { apiGet } = await loadApi();
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );

    const result = apiGet('/jobs', { signal: controller.signal }).catch((e) => e);
    const reason = new DOMException('left the page', 'AbortError');
    controller.abort(reason);

    expect(await result).toBe(reason);
    expect(reportApiFailure).not.toHaveBeenCalled();
  });

  it('aborts immediately when the caller signal is already aborted', async () => {
    const { apiGet } = await loadApi();
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.signal!.aborted) throw init.signal!.reason;
      return jsonResponse({});
    });
    await expect(apiGet('/jobs', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops waiting for a retry when the caller aborts', async () => {
    vi.useFakeTimers();
    const { apiGet } = await loadApi();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(jsonResponse({}, 503, { 'retry-after': '1' }));

    const result = apiGet('/jobs', { signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('session token handling', () => {
  it('stores the token in localStorage and clears the legacy session copy', async () => {
    const { setAccessToken, hasAccessToken } = await loadApi();
    sessionStorage.setItem('verse_access_token', 'old');
    setAccessToken('new-token');
    expect(localStorage.getItem('verse_access_token')).toBe('new-token');
    expect(sessionStorage.getItem('verse_access_token')).toBeNull();
    expect(hasAccessToken()).toBe(true);

    setAccessToken(null);
    expect(localStorage.getItem('verse_access_token')).toBeNull();
    expect(hasAccessToken()).toBe(false);
  });

  it('moves a legacy sessionStorage token into localStorage once', async () => {
    sessionStorage.setItem('verse_access_token', 'legacy-token');
    const { hasAccessToken } = await loadApi();
    expect(hasAccessToken()).toBe(true);
    expect(localStorage.getItem('verse_access_token')).toBe('legacy-token');
    expect(sessionStorage.getItem('verse_access_token')).toBeNull();
  });

  it('keeps the session in memory when storage is blocked', async () => {
    const restoreLocal = blockStorage('localStorage');
    const restoreSession = blockStorage('sessionStorage');
    try {
      const { apiGet, setAccessToken, hasAccessToken } = await loadApi();
      expect(hasAccessToken()).toBe(false);
      setAccessToken('memory-token');
      expect(hasAccessToken()).toBe(true);
      fetchMock.mockResolvedValue(jsonResponse({}));
      await apiGet('/me');
      expect(lastRequest().init.headers.get('Authorization')).toBe('Bearer memory-token');
    } finally {
      restoreLocal();
      restoreSession();
    }
  });

  it('reads from memory after a write fails even if the store becomes readable', async () => {
    const { setAccessToken, hasAccessToken } = await loadApi();
    localStorage.setItem('verse_access_token', 'stale');
    const restore = blockStorage('localStorage');
    setAccessToken(null);
    restore();
    // The stale token is still in real storage, but the failed sign-out wins.
    expect(localStorage.getItem('verse_access_token')).toBe('stale');
    expect(hasAccessToken()).toBe(false);
  });

  it('follows sign-in and sign-out in other tabs', async () => {
    const { onAccessTokenChange, hasAccessToken } = await loadApi();
    const listener = vi.fn();
    const stop = onAccessTokenChange(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x', storageArea: localStorage }));
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'verse_access_token', newValue: 'x', storageArea: sessionStorage }),
    );
    expect(listener).not.toHaveBeenCalled();

    localStorage.setItem('verse_access_token', 'other-tab');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'verse_access_token', newValue: 'other-tab', storageArea: localStorage }),
    );
    expect(listener).toHaveBeenLastCalledWith(true);
    expect(hasAccessToken()).toBe(true);

    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    expect(listener).toHaveBeenLastCalledWith(false);

    stop();
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'verse_access_token', newValue: 'again', storageArea: localStorage }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores storage events when localStorage cannot be read', async () => {
    const { onAccessTokenChange } = await loadApi();
    const listener = vi.fn();
    const stop = onAccessTokenChange(listener);
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    const event = new StorageEvent('storage', { key: 'verse_access_token', newValue: 'x' });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      window.dispatchEvent(event);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

describe('401 handling', () => {
  it('signs out and sends a protected page to sign-in, remembering where it was', async () => {
    const { location, restore } = fakeLocation('/employer/jobs', '?tab=open');
    try {
      const { apiGet, setAccessToken, hasAccessToken, consumeReturnTo } = await loadApi();
      setAccessToken('expired');
      fetchMock.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));

      await expect(apiGet('/employer/jobs')).rejects.toMatchObject({ status: 401 });
      expect(hasAccessToken()).toBe(false);
      expect(location.replace).toHaveBeenCalledWith('/auth/employer');

      // Signing in again re-arms the redirect for the next expired session.
      setAccessToken('expired-again');
      await expect(apiGet('/me')).rejects.toMatchObject({ status: 401 });
      expect(location.replace).toHaveBeenCalledTimes(2);

      expect(consumeReturnTo()).toBe('/employer/jobs?tab=open');
      expect(consumeReturnTo()).toBeNull();
    } finally {
      restore();
    }
  });

  it('does not redirect from public pages, auth calls or when asked not to', async () => {
    const { location, restore } = fakeLocation('/jobs');
    try {
      const { api, setAccessToken, hasAccessToken } = await loadApi();
      fetchMock.mockImplementation(async () => jsonResponse({ error: 'Unauthorized' }, 401));

      setAccessToken('t1');
      await expect(api('/me')).rejects.toMatchObject({ status: 401 });
      expect(hasAccessToken()).toBe(false);

      location.pathname = '/jobseeker';
      setAccessToken('t2');
      await expect(api('/auth/logout', { method: 'POST' })).rejects.toMatchObject({ status: 401 });
      setAccessToken('t3');
      await expect(api('/me', { skipAuthRedirect: true })).rejects.toMatchObject({ status: 401 });
      // Signed out already: nothing to clear, nowhere to send.
      await expect(api('/me')).rejects.toMatchObject({ status: 401 });

      expect(location.replace).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('keeps a newer session signed in by another tab while the request was in flight', async () => {
    const { apiGet, setAccessToken, hasAccessToken } = await loadApi();
    setAccessToken('old');
    fetchMock.mockImplementation(async () => {
      setAccessToken('new-from-other-tab');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    });

    await expect(apiGet('/me')).rejects.toMatchObject({ status: 401 });
    expect(hasAccessToken()).toBe(true);
    expect(localStorage.getItem('verse_access_token')).toBe('new-from-other-tab');
  });
});
