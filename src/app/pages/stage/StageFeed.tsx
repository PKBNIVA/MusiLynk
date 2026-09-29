import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Music4, Users } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { PageHeader } from '../../components/PageHeader';
import { HelpCallout } from '../../components/help/HelpCallout';
import { HELP } from '../../components/help/helpContent';
import { EmptyState } from '../../components/help/EmptyState';
import { Skeleton } from '../../components/ui/skeleton';
import { Composer } from '../../components/stage/Composer';
import { EventStrip } from '../../components/stage/EventStrip';
import { PostCard } from '../../components/stage/PostCard';
import { useFeedList } from '../../components/stage/useFeedList';
import { fetchFeed, authorPath } from '../../lib/stage';
import { usePageMeta } from '../../components/PageMeta';

export default function StageFeed() {
  usePageMeta('The Stage', "Updates, performances, releases and gigs from Verse's music community.");
  const { posts, loading, loadingMore, error, done, loadMore, update, remove, prepend } = useFeedList(
    'feed',
    fetchFeed,
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  // "Trending" authors from the first page of active posts, for the first-run suggestion —
  // the API has no dedicated "who to follow" endpoint, so this uses the feed's own posts.
  const suggestions = Array.from(
    new Map(posts.map((p) => [`${p.author.type}:${p.author.id}`, p.author])).values(),
  ).slice(0, 6);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
        <PageHeader title="Stage" />
        <HelpCallout {...HELP.stage} />

        <EventStrip />

        <div className="mb-5">
          <Composer onPosted={prepend} />
        </div>

        {loading && (
          <ul className="space-y-4" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="verse-surface rounded-2xl border border-white/10 bg-white/[.03] p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <Skeleton className="mt-4 h-3.5 w-full" />
                <Skeleton className="mt-2 h-3.5 w-3/4" />
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}

        {!loading && !error && posts.length === 0 && (
          <EmptyState icon={Music4} title="The Stage is quiet here" action={null}>
            No posts to show yet. Follow people and Pages to fill your feed — here are a few active on Verse right now.
            {suggestions.length > 0 && (
              <ul className="mt-4 flex flex-wrap justify-center gap-2">
                {suggestions.map((a) => (
                  <li key={`${a.type}:${a.id}`}>
                    <Link
                      to={authorPath(a)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[.04] px-3 py-1.5 text-sm text-slate-100 hover:bg-white/[.08]"
                    >
                      <Users aria-hidden="true" size={14} />
                      {a.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </EmptyState>
        )}

        {!loading && posts.length > 0 && (
          <ul role="feed" aria-busy={loadingMore} aria-label="The Stage feed" className="space-y-4">
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
