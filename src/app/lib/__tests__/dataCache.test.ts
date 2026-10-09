import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, writeListeners, identityListeners } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  writeListeners: new Set<(method: string, path: string) => void>(),
  identityListeners: new Set<() => void>(),
}));
vi.mock('../api', () => ({
  apiGet,
  onApiWrite: (l: (method: string, path: string) => void) => (writeListeners.add(l), () => writeListeners.delete(l)),
  onIdentityChange: (l: () => void) => (identityListeners.add(l), () => identityListeners.delete(l)),
}));

import * as cache from '../dataCache';
import { CACHE_MAX_AGE_MS, CACHE_TTL_MS, PREFETCH_MIN_INTERVAL_MS } from '../dataCache.config';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T10:00:00Z'));
  apiGet.mockReset();
  cache.resetDataCacheForTests();
});
afterEach(() => vi.useRealTimers());

describe('cachedGet', () => {
  it('fetches once, then serves memory inside the TTL, then revalidates in the background when stale', async () => {
    apiGet.mockResolvedValueOnce({ talent: [1] });
    expect(await cache.cachedGet('/public/talent', { family: 'list' })).toEqual({ talent: [1] });
    expect(await cache.cachedGet('/public/talent', { family: 'list' })).toEqual({ talent: [1] });
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(cache.isFresh('/public/talent')).toBe(true);

    vi.advanceTimersByTime(CACHE_TTL_MS.list + 1);
    expect(cache.isFresh('/public/talent')).toBe(false);
    const refresh = deferred<unknown>();
    apiGet.mockReturnValueOnce(refresh.promise);
    const listener = vi.fn();
    cache.subscribe('/public/talent', listener);
    // Stale: the old page comes back at once...
    expect(await cache.cachedGet('/public/talent', { family: 'list' })).toEqual({ talent: [1] });
    expect(apiGet).toHaveBeenCalledTimes(2);
    // ...and the refresh wakes subscribers only when something changed.
    refresh.resolve({ talent: [1] });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CACHE_TTL_MS.list + 1);
    apiGet.mockResolvedValueOnce({ talent: [1, 2] });
    await cache.cachedGet('/public/talent', { family: 'list' });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.peek('/public/talent')).toEqual({ talent: [1, 2] });
  });

  it('shares one request between concurrent readers of the same path', async () => {
    const first = deferred<unknown>();
    apiGet.mockReturnValueOnce(first.promise);
    const a = cache.cachedGet('/jobs', { family: 'list' });
    const b = cache.cachedGet('/jobs', { family: 'list' });
    expect(apiGet).toHaveBeenCalledTimes(1);
    first.resolve({ jobs: [] });
    expect(await a).toEqual({ jobs: [] });
    expect(await b).toEqual({ jobs: [] });
  });

  it('drops entries past the maximum age and lets a failed request fall through to the caller', async () => {
    apiGet.mockResolvedValueOnce({ act: 1 });
    await cache.cachedGet('/public/acts/a1', { family: 'record' });
    vi.advanceTimersByTime(CACHE_MAX_AGE_MS + 1);
    expect(cache.peek('/public/acts/a1')).toBeUndefined();
    apiGet.mockRejectedValueOnce(new Error('offline'));
    await expect(cache.cachedGet('/public/acts/a1', { family: 'record' })).rejects.toThrow('offline');
    // The failure is not cached: the next read asks again.
    apiGet.mockResolvedValueOnce({ act: 2 });
    expect(await cache.cachedGet('/public/acts/a1', { family: 'record' })).toEqual({ act: 2 });
  });

  it('a TTL of 0 always revalidates but still answers from memory first', async () => {
    apiGet.mockResolvedValueOnce({ unread: 1 });
    await cache.cachedGet('/notifications/unread', { family: 'unread' });
    apiGet.mockResolvedValueOnce({ unread: 2 });
    expect(await cache.cachedGet('/notifications/unread', { family: 'unread' })).toEqual({ unread: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.peek('/notifications/unread')).toEqual({ unread: 2 });
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});

describe('invalidate, update and writes', () => {
  it('marks a prefix stale and wakes subscribers; update patches in place without a request', async () => {
    apiGet.mockResolvedValueOnce({ conversations: [{ id: 'c1' }] });
    await cache.cachedGet('/conversations', { family: 'list' });
    const listener = vi.fn();
    cache.subscribe('/conversations', listener);
    cache.realtime.invalidate('/conv');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.isFresh('/conversations')).toBe(false);
    cache.realtime.update<{ conversations: { id: string }[] }>('/conversations', (current) => ({
      conversations: [...(current?.conversations ?? []), { id: 'c2' }],
    }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(cache.peek('/conversations')).toEqual({ conversations: [{ id: 'c1' }, { id: 'c2' }] });
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('a successful write makes the configured paths stale, and an unknown one its own family', async () => {
    apiGet.mockResolvedValue({ ok: true });
    await cache.cachedGet('/conversations', { family: 'list' });
    await cache.cachedGet('/notifications/unread', { family: 'list' });
    await cache.cachedGet('/jobs', { family: 'list' });
    await cache.cachedGet('/widgets/1', { family: 'list' });
    writeListeners.forEach((l) => l('POST', '/conversations/c1/messages'));
    expect(cache.isFresh('/conversations')).toBe(false);
    expect(cache.isFresh('/notifications/unread')).toBe(false);
    expect(cache.isFresh('/jobs')).toBe(true);
    writeListeners.forEach((l) => l('PATCH', '/widgets/1'));
    expect(cache.isFresh('/widgets/1')).toBe(false);
  });

  it('a live update (socket event) makes the paths INVALIDATE_ON_EVENT names stale; other types change nothing', async () => {
    apiGet.mockResolvedValue({ ok: true });
    await cache.cachedGet('/conversations', { family: 'list' });
    await cache.cachedGet('/conversations/c1/messages', { family: 'list' });
    await cache.cachedGet('/notifications/unread', { family: 'list' });
    await cache.cachedGet('/notifications', { family: 'list' });
    await cache.cachedGet('/jobs', { family: 'list' });
    const thread = vi.fn();
    cache.subscribe('/conversations/c1/messages', thread);

    cache.realtime.event({ type: 'ping' });
    cache.realtime.event({});
    expect(thread).not.toHaveBeenCalled();
    expect(cache.isInvalidated('/conversations')).toBe(false);

    cache.realtime.event({ type: 'message', conversationId: 'c1' });
    expect(thread).toHaveBeenCalledTimes(1);
    expect(cache.isInvalidated('/conversations')).toBe(true);
    expect(cache.isInvalidated('/conversations/c1/messages')).toBe(true);
    expect(cache.isInvalidated('/notifications/unread')).toBe(true);
    expect(cache.isInvalidated('/notifications')).toBe(false);
    expect(cache.isInvalidated('/jobs')).toBe(false);
    // Memory is still shown while the refetch runs; the refetch clears the mark.
    expect(cache.peek('/conversations')).toEqual({ ok: true });
    await cache.cachedGet('/conversations', { family: 'list' });
    await vi.waitFor(() => expect(cache.isInvalidated('/conversations')).toBe(false));

    cache.realtime.event({ type: 'notification', id: 'n1' });
    expect(cache.isInvalidated('/notifications')).toBe(true);
    expect(cache.isInvalidated('/jobs')).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(6);
  });

  it('forgets everything when the identity changes', async () => {
    apiGet.mockResolvedValue({ me: 1 });
    await cache.cachedGet('/me', { family: 'record' });
    identityListeners.forEach((l) => l());
    expect(cache.peek('/me')).toBeUndefined();
  });
});

describe('optimistic', () => {
  it('applies at once, keeps the change on success and rolls back on failure', async () => {
    apiGet.mockResolvedValueOnce({ messages: [{ id: 'm1' }] });
    await cache.cachedGet('/conversations/c1/messages', { family: 'thread' });
    const listener = vi.fn();
    cache.subscribe('/conversations/c1/messages', listener);
    type Page = { messages: { id: string }[] };
    const append = (id: string) => (current: Page | undefined) => ({
      messages: [...(current?.messages ?? []), { id }],
    });

    await cache.optimistic<Page, string>('/conversations/c1/messages', append('tmp-1'), async () => 'ok');
    expect(cache.peek<Page>('/conversations/c1/messages')?.messages.map((m) => m.id)).toEqual(['m1', 'tmp-1']);

    await expect(
      cache.optimistic<Page, string>('/conversations/c1/messages', append('tmp-2'), async () => {
        throw new Error('blocked');
      }),
    ).rejects.toThrow('blocked');
    expect(cache.peek<Page>('/conversations/c1/messages')?.messages.map((m) => m.id)).toEqual(['m1', 'tmp-1']);
    expect(listener).toHaveBeenCalledTimes(3); // apply, apply, rollback
  });
});

describe('prefetch', () => {
  it('warms the cache quietly, skips fresh paths and respects the rate limit', async () => {
    apiGet.mockResolvedValue({ professional: {} });
    expect(cache.prefetch('/public/talent/u1')).toBe(true);
    expect(cache.prefetch('/public/talent/u2')).toBe(false); // too soon
    vi.advanceTimersByTime(PREFETCH_MIN_INTERVAL_MS);
    expect(cache.prefetch('/public/talent/u2')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.isFresh('/public/talent/u1')).toBe(true);
    vi.advanceTimersByTime(PREFETCH_MIN_INTERVAL_MS);
    expect(cache.prefetch('/public/talent/u1')).toBe(false); // already fresh
    expect(apiGet).toHaveBeenCalledTimes(2);
    apiGet.mockRejectedValueOnce(new Error('offline'));
    vi.advanceTimersByTime(PREFETCH_MIN_INTERVAL_MS);
    expect(cache.prefetch('/public/talent/u3')).toBe(true); // a failing prefetch never throws
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('sameData', () => {
  it('compares JSON payloads structurally', () => {
    expect(cache.sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(cache.sameData({ a: [1] }, { a: [1, 2] })).toBe(false);
    expect(cache.sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(cache.sameData(null, {})).toBe(false);
    expect(cache.sameData([], {})).toBe(false);
  });
});

describe('cache epoch and in-flight requests', () => {
  it('drops a response that began before clear()', async () => {
    const slow = deferred<unknown>();
    apiGet.mockReturnValueOnce(slow.promise);
    const pending = cache.cachedGet('/me');
    cache.clear();
    slow.resolve({ who: 'old identity' });
    await pending;
    expect(cache.peek('/me')).toBeUndefined();
    apiGet.mockResolvedValueOnce({ who: 'new identity' });
    expect(await cache.cachedGet('/me')).toEqual({ who: 'new identity' });
    expect(cache.peek('/me')).toEqual({ who: 'new identity' });
  });

  it('does not reuse an in-flight GET after invalidate: starts a fresh one and ignores the older result', async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    apiGet.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = cache.cachedGet('/conversations');
    cache.invalidate('/conversations');
    const second = cache.cachedGet('/conversations');
    expect(apiGet).toHaveBeenCalledTimes(2);
    newer.resolve({ v: 2 });
    await second;
    older.resolve({ v: 1 });
    await first;
    expect(cache.peek('/conversations')).toEqual({ v: 2 });
  });

  it('a forced read starts a fresh request and the older result is ignored', async () => {
    const older = deferred<unknown>();
    apiGet.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ v: 2 });
    const first = cache.cachedGet('/thread');
    expect(await cache.cachedGet('/thread', { force: true })).toEqual({ v: 2 });
    older.resolve({ v: 1 });
    await first;
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(cache.peek('/thread')).toEqual({ v: 2 });
  });

  it('still shares one request between plain concurrent reads', async () => {
    const d = deferred<unknown>();
    apiGet.mockReturnValueOnce(d.promise);
    const a = cache.cachedGet('/x');
    const b = cache.cachedGet('/x');
    d.resolve({ ok: 1 });
    await Promise.all([a, b]);
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});
