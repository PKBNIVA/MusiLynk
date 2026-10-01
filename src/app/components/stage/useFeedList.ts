import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/errors';
import type { FeedPage, StagePost } from '../../lib/stage';

/**
 * Cursor-paginated post list with an IntersectionObserver "load more" sentinel. `fetchPage`
 * is stable-keyed by the caller (feed / tag / author) via `key`, so switching tags or authors
 * resets the list instead of appending to the previous one.
 */
export function useFeedList(key: string, fetchPage: (cursor?: string | null) => Promise<FeedPage>) {
  const [posts, setPosts] = useState<StagePost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = useCallback(async (nextCursor?: string | null, replace = false) => {
    if (replace) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      const page = await fetchRef.current(nextCursor);
      setPosts((prev) => {
        if (replace) return page.posts;
        // A re-ranked feed can serve a post again on a later page; show each post once.
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...page.posts.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
      setDone(!page.nextCursor);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Unable to load the Stage right now.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setDone(false);
    void load(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(() => {
    if (!loading && !loadingMore && !done && cursor) void load(cursor, false);
  }, [cursor, done, loading, loadingMore, load]);

  const update = useCallback((updated: StagePost) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const remove = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const prepend = useCallback((post: StagePost) => {
    setPosts((prev) => [post, ...prev]);
  }, []);

  return {
    posts,
    loading,
    loadingMore,
    error,
    done,
    loadMore,
    update,
    remove,
    prepend,
    reload: () => load(null, true),
  };
}
