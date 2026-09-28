import { useCallback, useRef, useState } from 'react';
import { apiGet } from './api';
import { useLatestCallback } from './useLatestCallback';
import type { SearchMeta } from './apiTypes';

/** Paging fields every cursor-paged list response carries, plus how a search read the query. */
export type PageMeta = SearchMeta & { nextCursor?: string | null; total?: number };

type Fetcher<P> = (path: string) => Promise<P>;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** `base?query&cursor=…` with the cursor set when given. */
export const pagePath = (base: string, q: string, after?: string | null) => {
  const params = new URLSearchParams(q);
  if (after) params.set('cursor', after);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
};

const defaultFetch = <P>(path: string) => apiGet<P>(path);

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
  // Ids already listed for the current search (the list's length, and duplicates to skip).
  const listed = useRef(new Set<string | number>());
  const pickRows = useLatestCallback(pick);

  /** Loads the first page for `q`. Resolves to an error message, or null on success (or when superseded). */
  const search = useCallback(
    async (q: string): Promise<string | null> => {
      const n = ++generation.current;
      query.current = q;
      moreInFlight.current = false;
      setLoading(true);
      setLoadingMore(false);
      setError('');
      setMoreError('');
      try {
        const page = await fetchPage(pagePath(path, q));
        if (n !== generation.current) return null;
        const list = pickRows(page) || [];
        listed.current = new Set(list.map((item) => item.id));
        setItems(list);
        setCursor(page.nextCursor || null);
        setTotal(typeof page.total === 'number' ? page.total : list.length);
        setMeta({ interpretedAs: page.interpretedAs, matchMode: page.matchMode, didYouMean: page.didYouMean });
        setFirst(page);
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
    [fetchPage, path, noun, pickRows],
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
  }, [cursor, fetchPage, path, noun, pickRows]);

  return {
    items,
    setItems,
    total,
    meta,
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
