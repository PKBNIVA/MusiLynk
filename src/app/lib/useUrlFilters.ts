import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useHydrated } from './hydrated';

/**
 * Search filters kept in the URL (?q=…&location=…), so a search can be reloaded, shared and
 * bookmarked, and each change is its own history entry: Back undoes the last filter.
 *
 * `values` has every key ('' when absent); `query` is the non-empty ones as a query string, in
 * `keys` order (use it as the effect dependency that runs the search). Pass `keys` as a
 * module-level constant so its identity is stable. `update` and `clear` return whether the URL
 * changed (when it did not, a caller that wants a fresh search runs it itself). `update` pushes a new entry
 * (unless nothing changed, or `{ replace: true }` rewrites the current one); `clear` removes every key.
 *
 * `ready` is false for the one render that hydrates pre-rendered HTML (which cannot know the query
 * string): `values` and `query` are then empty, and the effect that runs the search should wait for it.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [liveParams, setParams] = useSearchParams();
  const ready = useHydrated();
  const params = useMemo(() => (ready ? liveParams : new URLSearchParams()), [ready, liveParams]);
  const values = useMemo(
    () => Object.fromEntries(keys.map((key) => [key, params.get(key) || ''])) as Record<K, string>,
    [params, keys],
  );
  const query = useMemo(() => {
    const next = new URLSearchParams();
    keys.forEach((key) => {
      const value = params.get(key);
      if (value) next.set(key, value);
    });
    return next.toString();
  }, [params, keys]);

  const apply = useCallback(
    (change: (next: URLSearchParams) => void, replace = false) => {
      const next = new URLSearchParams(params);
      change(next);
      if (next.toString() === params.toString()) return false;
      setParams(next, replace ? { replace: true } : undefined);
      return true;
    },
    [params, setParams],
  );

  const update = useCallback(
    (changes: Partial<Record<K, string>>, options: { replace?: boolean } = {}) =>
      apply((next) => {
        (Object.entries(changes) as [K, string | undefined][]).forEach(([key, value]) => {
          const text = (value || '').trim();
          if (text) next.set(key, text);
          else next.delete(key);
        });
      }, options.replace),
    [apply],
  );

  const clear = useCallback(
    () =>
      apply((next) => {
        keys.forEach((key) => next.delete(key));
      }),
    [apply, keys],
  );

  return { values, query, update, clear, ready };
}
