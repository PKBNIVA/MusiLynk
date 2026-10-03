import { useCallback, useRef, useState } from 'react';
import { cachedGet, isFresh, peek, prefetch } from './dataCache';
import { CACHE_TTL_MS } from './dataCache.config';
import { useLatestCallback } from './useLatestCallback';
import type { SearchMeta } from './apiTypes';

/** Paging fields every cursor-paged list response carries, plus how a search read the query. */
export type PageMeta = SearchMeta & { nextCursor?: string | null; total?: number };

/** Loads one page; `force` skips the client cache (an explicit re-run of the same search). */
type Fetcher<P> = (path: string, options?: { force?: boolean }) => Promise<P>;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** `base?query&cursor=…` with the cursor set when given. */
export const pagePath = (base: string, q: string, after?: string | null) => {
  const params = new URLSearchParams(q);
  if (after) params.set('cursor', after);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
};

// Pages come through the client data cache (dataCache.ts): a page fetched a minute ago needs no request.
const defaultFetch = <P>(path: string, options?: { force?: boolean }) =>
  cachedGet<P>(path, { family: 'list', force: options?.force });

/** A list as it was last shown for one path + query: every page loaded, so Back shows it at once. */
type Remembered<T, P> = {
  items: T[];
  cursor: string | null;
  total: number;
  meta: SearchMeta;
  first: P | null;
  at: number;
};
const remembered = new Map<string, Remembered<unknown, unknown>>();
/** Test hook: forget every remembered list. */
export function forgetListsForTests() {
  remembered.clear();
}

type Options<T, P> = {
  /** API path without a query, e.g. "/public/talent". */
  path: string;
  /** The rows of one page, e.g. `(page) => page.talent`. */
  pick: (page: P) => T[] | undefined;
  /** What to call the rows in error messages ("professionals"). */
  noun: string;
  fetchPage?: Fetcher<P>;
};

/**
 * A cursor-paged list (talent, candidates, acts, jobs, global search by type).
 *
 * `search(query)` starts over with new filters (a URLSearchParams string without cursor);
 * `loadMore()` appends the next page. Only the newest search may change the list, so a slow
 * earlier response (first page or "load more") never overwrites newer results. `meta` holds how
 * the API read the query (interpretedAs, matchMode, didYouMean) for the current search.
 */
export function usePagedList<T extends { id: string | number }, P extends PageMeta>({
  path,
  pick,
  noun,
  fetchPage = defaultFetch,
}: Options<T, P>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<SearchMeta>({});
  const [first, setFirst] = useState<P | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const generation = useRef(0);
  const query = useRef('');
  const moreInFlight = useRef(false);
  const searchedOnce = useRef(false);
  // Ids already listed for the current search (the list's length, and duplicates to skip).
  const listed = useRef(new Set<string | number>());
  const pickRows = useLatestCallback(pick);
  const remember = useCallback(
    (q: string, state: Omit<Remembered<T, P>, 'at'>) => {
      remembered.set(`${path}?${q}`, { ...state, at: Date.now() } as Remembered<unknown, unknown>);
    },
    [path],
  );

  /** Loads the first page for `q`. Resolves to an error message, or null on success (or when superseded). */
  const search = useCallback(
    async (q: string): Promise<string | null> => {
      const n = ++generation.current;
      // The same query searched again (the Search button, "Try again") is an explicit refresh: it goes to the
      // network. A first search or a new query may be answered from memory (back-navigation).
      const rerun = searchedOnce.current && query.current === q;
      searchedOnce.current = true;
      query.current = q;
      moreInFlight.current = false;
      setLoadingMore(false);
      setError('');
      setMoreError('');
      const firstPath = pagePath(path, q);
      // Back-navigation: the list as it was (every page) comes back at once, with no request while the
      // first page is still fresh; a stale first page is refreshed underneath and replaces it if changed.
      const kept = rerun ? undefined : (remembered.get(`${path}?${q}`) as Remembered<T, P> | undefined);
      const stillFresh = kept && Date.now() - kept.at < CACHE_TTL_MS.list;
      if (kept && peek(firstPath) !== undefined) {
        listed.current = new Set(kept.items.map((item) => item.id));
        setItems(kept.items);
        setCursor(kept.cursor);
        setTotal(kept.total);
        setMeta(kept.meta);
        setFirst(kept.first);
        setLoading(false);
        if (stillFresh && isFresh(firstPath)) return null;
      } else setLoading(true);
      try {
        const page = rerun ? await fetchPage(firstPath, { force: true }) : await fetchPage(firstPath);
        if (n !== generation.current) return null;
        const list = pickRows(page) || [];
        if (kept && page === kept.first) return null; // the cache answered with the very page we show
        listed.current = new Set(list.map((item) => item.id));
        setItems(list);
        setCursor(page.nextCursor || null);
        setTotal(typeof page.total === 'number' ? page.total : list.length);
        setMeta({ interpretedAs: page.interpretedAs, matchMode: page.matchMode, didYouMean: page.didYouMean });
        setFirst(page);
        remember(q, {
          items: list,
          cursor: page.nextCursor || null,
          total: typeof page.total === 'number' ? page.total : list.length,
          meta: { interpretedAs: page.interpretedAs, matchMode: page.matchMode, didYouMean: page.didYouMean },
          first: page,
        });
        return null;
      } catch (e) {
        if (n !== generation.current) return null;
        const message = messageOf(e, `Unable to load ${noun}`);
        setError(message);
        return message;
      } finally {
        if (n === generation.current) setLoading(false);
      }
    },
    [fetchPage, path, noun, pickRows, remember],
  );

  /** Appends the next page. Resolves to the index of the first new item, or null when nothing was added. */
  const loadMore = useCallback(async (): Promise<number | null> => {
    if (!cursor || moreInFlight.current) return null;
    const n = generation.current;
    moreInFlight.current = true;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await fetchPage(pagePath(path, query.current, cursor));
      if (n !== generation.current) return null;
      const start = listed.current.size;
      const fresh = (pickRows(page) || []).filter((item) => !listed.current.has(item.id));
      fresh.forEach((item) => listed.current.add(item.id));
      if (fresh.length) setItems((current) => [...current, ...fresh]);
      setCursor(page.nextCursor || null);
      if (typeof page.total === 'number') setTotal(page.total);
      const kept = remembered.get(`${path}?${query.current}`) as Remembered<T, P> | undefined;
      if (kept)
        remember(query.current, {
          ...kept,
          items: [...kept.items, ...fresh],
          cursor: page.nextCursor || null,
          total: typeof page.total === 'number' ? page.total : kept.total,
        });
      return fresh.length ? start : null;
    } catch (e) {
      if (n === generation.current) setMoreError(messageOf(e, `Unable to load more ${noun}`));
      return null;
    } finally {
      if (n === generation.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, [cursor, fetchPage, path, noun, pickRows, remember]);

  /** Warms the cache for the next page (call when the visitor is within a screen of the bottom). */
  const prefetchMore = useCallback(() => {
    if (cursor && !moreInFlight.current) prefetch(pagePath(path, query.current, cursor), 'list');
  }, [cursor, path]);

  return {
    items,
    setItems,
    total,
    meta,
    prefetchMore,
    /** The current search's first page as the API sent it (for extra fields such as per-type totals). */
    first,
    loading,
    loadingMore,
    error,
    moreError,
    hasMore: Boolean(cursor),
    search,
    loadMore,
  };
}
