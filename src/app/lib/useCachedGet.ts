import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedGet, peek, prefetch, subscribe, type CachedGetOptions } from './dataCache';
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
      const data = await cachedGet<T>(path, { ...options, family, force });
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
    return subscribe(path, () => {
      const next = peek<T>(path);
      if (next === undefined) void load();
      else setState((current) => (current.data === next ? current : { data: next, error: undefined, loading: false }));
    });
  }, [path, load]);
  const refresh = useCallback(() => load(true), [load]);
  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

/**
 * Event handlers that warm the cache for the page a card leads to: pointer hover and keyboard focus on
 * a desktop, the first touch on a phone. Rate-limited by `prefetch`; nothing is fetched twice.
 */
export function usePrefetchIntent(path: string | null, family: CacheFamily = 'record') {
  const start = useCallback(() => {
    if (path) prefetch(path, family);
  }, [path, family]);
  return useMemo(() => ({ onMouseEnter: start, onFocus: start, onTouchStart: start }), [start]);
}
