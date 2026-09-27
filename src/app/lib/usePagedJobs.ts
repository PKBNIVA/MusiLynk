import { useCallback, useRef, useState } from 'react';
import { apiGet } from './api';

/** One page of GET /jobs: the jobs, an opaque cursor for the next page (null on the last) and the match count. */
export type JobPage<T> = { jobs?: T[]; nextCursor?: string | null; total?: number };

type Fetcher<T> = (path: string) => Promise<JobPage<T>>;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const pathFor = (q: string, after?: string | null) => {
  const params = new URLSearchParams(q);
  if (after) params.set('cursor', after);
  const text = params.toString();
  return text ? `/jobs?${text}` : '/jobs';
};

const fetchJobs = <T>(path: string) => apiGet<JobPage<T>>(path);

/**
 * The paged opportunity list behind job search and the public jobs page.
 *
 * `search(query)` starts over with new filters (a URLSearchParams string without limit/cursor);
 * `loadMore()` appends the next page. Only the newest search may change the list, so a slow
 * earlier response (first page or "load more") never overwrites newer results.
 */
export function usePagedJobs<T extends { id: string | number }>(fetchPage: Fetcher<T> = fetchJobs) {
  const [jobs, setJobs] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
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
        const page = await fetchPage(pathFor(q));
        if (n !== generation.current) return null;
        const list = page.jobs || [];
        listed.current = new Set(list.map((job) => job.id));
        setJobs(list);
        setCursor(page.nextCursor || null);
        setTotal(typeof page.total === 'number' ? page.total : list.length);
        return null;
      } catch (e) {
        if (n !== generation.current) return null;
        const message = messageOf(e, 'Unable to load opportunities');
        setError(message);
        return message;
      } finally {
        if (n === generation.current) setLoading(false);
      }
    },
    [fetchPage],
  );

  /** Appends the next page. Resolves to the index of the first new job, or null when nothing was added. */
  const loadMore = useCallback(async (): Promise<number | null> => {
    if (!cursor || moreInFlight.current) return null;
    const n = generation.current;
    moreInFlight.current = true;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await fetchPage(pathFor(query.current, cursor));
      if (n !== generation.current) return null;
      const start = listed.current.size;
      const fresh = (page.jobs || []).filter((job) => !listed.current.has(job.id));
      fresh.forEach((job) => listed.current.add(job.id));
      if (fresh.length) setJobs((current) => [...current, ...fresh]);
      setCursor(page.nextCursor || null);
      if (typeof page.total === 'number') setTotal(page.total);
      return fresh.length ? start : null;
    } catch (e) {
      if (n === generation.current) setMoreError(messageOf(e, 'Unable to load more opportunities'));
      return null;
    } finally {
      if (n === generation.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, [cursor, fetchPage]);

  return {
    jobs,
    setJobs,
    total,
    loading,
    loadingMore,
    error,
    moreError,
    hasMore: Boolean(cursor),
    search,
    loadMore,
  };
}
