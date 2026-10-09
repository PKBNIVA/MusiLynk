import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cachedGet, isInvalidated, peek, prefetch, subscribe, type CachedGetOptions } from './dataCache';
import type { CacheFamily } from './dataCache.config';
import { useLatestCallback } from './useLatestCallback';

type State<T> = { data: T | undefined; error: unknown; loading: boolean };

/**
 * A GET through the client data cache (src/app/lib/dataCache.ts) as React state. The first render
 * already has the cached data when there is any (no blank, no spinner on back-navigation); a stale
 * entry is refreshed in the background and the component re-renders only if the data changed.
 * `path` null renders nothing and requests nothing. `refresh()` forces a request (polling).
 */
export function useCachedGet<T>(path: string | null, options: { family?: CacheFamily } & CachedGetOptions = {}) {
  const { family = 'other' } = options;
  const [state, setState] = useState<State<T>>(() => {
    const data = path ? peek<T>(path) : undefined;
    return { data, error: undefined, loading: Boolean(path) && data === undefined };
  });
  const load = useLatestCallback(async (forceArg?: boolean) => {
    const force = forceArg === true;
    if (!path) return;
    try {
      const resolved = await cachedGet<T>(path, { ...options, family, force });
      // A stale answer resolves at once while its refresh runs; if the refresh already landed, show that.
      const data = peek<T>(path) ?? resolved;
      setState((current) =>
        current.data === data && !current.loading && !current.error
          ? current
          : { data, error: undefined, loading: false },
      );
    } catch (error) {
      setState((current) => ({ data: current.data, error, loading: false }));
    }
  });
  useEffect(() => {
    if (!path) {
      setState({ data: undefined, error: undefined, loading: false });
      return;
    }
    const cached = peek<T>(path);
    setState((current) =>
      current.data === cached && !current.loading
        ? current
        : { data: cached, error: undefined, loading: cached === undefined },
    );
    void load();
    // The cache tells us when this path changed (a refresh, a write, realtime.update): re-read it.
    // When it was marked stale (a write, a live update, realtime.invalidate), refetch: this screen shows it.
    return subscribe(path, () => {
      const next = peek<T>(path);
      if (next === undefined || isInvalidated(path)) void load();
      if (next !== undefined)
        setState((current) => (current.data === next ? current : { data: next, error: undefined, loading: false }));
    });
  }, [path, load]);
  const refresh = useCallback(() => load(true), [load]);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

/** How long a finger must rest on a card before it counts as a tap-in-progress rather than a scroll. */
export const TOUCH_PREFETCH_DELAY_MS = 120;

/**
 * Event handlers that warm the cache for the page a card leads to: pointer hover and keyboard focus on
 * a desktop; on a phone, a touch that rests for a moment without moving (pointerdown + a short delay,
 * cancelled by pointermove, pointerup, pointercancel or leaving), so scrolling past cards fetches nothing.
 * Rate-limited by `prefetch`; nothing is fetched twice.
 */
export function usePrefetchIntent(path: string | null, family: CacheFamily = 'record') {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useCallback(() => {
    if (path) prefetch(path, family);
  }, [path, family]);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const onPointerDown = useCallback(
    (event: { pointerType?: string }) => {
      cancel();
      // A mouse is covered by hover; only touch and pen wait for a rest.
      if (event.pointerType === 'mouse') return;
      timer.current = setTimeout(() => {
        timer.current = null;
        start();
      }, TOUCH_PREFETCH_DELAY_MS);
    },
    [cancel, start],
  );
  return useMemo(
    () => ({
      onMouseEnter: start,
      onFocus: start,
      onPointerDown,
      onPointerMove: cancel,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
    }),
    [start, onPointerDown, cancel],
  );
}
