import { useCallback, useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { Hash } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { EmptyState } from '../../components/help/EmptyState';
import { Skeleton } from '../../components/ui/skeleton';
import { PostCard } from '../../components/stage/PostCard';
import { useFeedList } from '../../components/stage/useFeedList';
import { fetchTagPosts } from '../../lib/stage';
import { usePageMeta } from '../../components/PageMeta';

export default function StageTag() {
  const { tag = '' } = useParams();
  usePageMeta(`#${tag}`, `Posts tagged #${tag} on the Stage.`);
  const fetchPage = useCallback((cursor?: string | null) => fetchTagPosts(tag, cursor), [tag]);
  const { posts, loading, loadingMore, error, done, loadMore, update, remove } = useFeedList(`tag:${tag}`, fetchPage);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), {
      rootMargin: '400px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
        <h1 className="flex items-center gap-1.5 text-2xl font-bold">
          <Hash aria-hidden="true" className="text-violet-300" />
          {tag}
        </h1>

        {loading && (
          <ul className="mt-5 space-y-4" aria-hidden="true">
            {[0, 1].map((i) => (
              <li key={i}>
                <Skeleton className="h-40 rounded-2xl" />
              </li>
            ))}
          </ul>
        )}
        {!loading && error && (
          <p role="alert" className="mt-5 text-sm text-rose-300">
            {error}
          </p>
        )}
        {!loading && !error && posts.length === 0 && (
          <EmptyState icon={Hash} title={`No posts tagged #${tag} yet`} className="mt-6">
            Be the first to post with this tag.
          </EmptyState>
        )}
        {!loading && posts.length > 0 && (
          <ul role="feed" aria-busy={loadingMore} aria-label={`Posts tagged ${tag}`} className="mt-5 space-y-4">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} onChanged={update} onDeleted={remove} />
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinelRef} />
        {loadingMore && <p className="py-4 text-center text-sm text-slate-500">Loading more…</p>}
        {done && posts.length > 0 && <p className="py-4 text-center text-sm text-slate-500">You're all caught up.</p>}
      </main>
    </div>
  );
}
