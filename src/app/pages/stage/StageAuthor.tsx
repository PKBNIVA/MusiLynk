import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ShieldCheck, Music4 } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { EmptyState } from '../../components/help/EmptyState';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { PostCard } from '../../components/stage/PostCard';
import { FollowButton } from '../../components/stage/FollowButton';
import { useFeedList } from '../../components/stage/useFeedList';
import { fetchAuthorPosts, fetchFollowers, type StageAuthorType } from '../../lib/stage';
import { usePageMeta } from '../../components/PageMeta';

export default function StageAuthor() {
  const { type = 'user', id = '' } = useParams<{ type: StageAuthorType; id: string }>();
  const [name, setName] = useState('');
  const [verified, setVerified] = useState(false);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  usePageMeta(name || 'Stage profile', name ? `${name}'s posts on the Stage.` : undefined);

  const fetchPage = useCallback(
    (cursor?: string | null) => fetchAuthorPosts(type as StageAuthorType, id, cursor),
    [type, id],
  );
  const { posts, loading, loadingMore, error, done, loadMore, update, remove } = useFeedList(
    `author:${type}:${id}`,
    fetchPage,
  );
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (posts[0]) {
      setName(posts[0].author.name);
      setVerified(Boolean(posts[0].author.verified));
    }
  }, [posts]);

  useEffect(() => {
    let alive = true;
    fetchFollowers(type as StageAuthorType, id)
      .then((d) => {
        if (!alive) return;
        setFollowersCount(d.followersCount);
        setFollowing(d.following);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [type, id]);

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
        <header className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="bg-violet-500/20 text-2xl text-violet-200">
              {(name || '?').charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 truncate text-2xl font-bold">
              {name || 'Loading…'}
              {verified && <ShieldCheck aria-hidden="true" size={18} className="text-emerald-400" />}
            </h1>
            {followersCount !== null && (
              <p className="text-sm text-slate-400">
                {followersCount} follower{followersCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
          <FollowButton type={type as StageAuthorType} id={id} initialFollowing={following} />
        </header>

        {loading && (
          <ul className="mt-6 space-y-4" aria-hidden="true">
            {[0, 1].map((i) => (
              <li key={i}>
                <Skeleton className="h-40 rounded-2xl" />
              </li>
            ))}
          </ul>
        )}
        {!loading && error && (
          <p role="alert" className="mt-6 text-sm text-rose-300">
            {error}
          </p>
        )}
        {!loading && !error && posts.length === 0 && (
          <EmptyState icon={Music4} title="No posts yet" className="mt-6">
            Nothing shared to the Stage yet.
          </EmptyState>
        )}
        {!loading && posts.length > 0 && (
          <ul role="feed" aria-busy={loadingMore} aria-label={`${name}'s posts`} className="mt-6 space-y-4">
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
