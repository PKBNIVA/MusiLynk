import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ShieldCheck, Music4 } from 'lucide-react';
import { Navigation } from '../../components/Navigation';
import { EmptyState } from '../../components/kit/EmptyState';
import { Skeleton } from '../../components/ui/skeleton';
import { UserAvatar } from '../../components/kit/UserAvatar';
import { PostCard } from '../../components/stage/PostCard';
import { FollowButton } from '../../components/stage/FollowButton';
import { useFeedList } from '../../components/stage/useFeedList';
import { errorStatus } from '../../lib/errors';
import {
  fetchAuthor,
  fetchAuthorPosts,
  fetchFollowers,
  type StageAuthor as Author,
  type StageAuthorType,
} from '../../lib/stage';
import { usePageMeta } from '../../components/PageMeta';

export default function StageAuthor() {
  const { type = 'user', id = '' } = useParams<{ type: StageAuthorType; id: string }>();
  const [author, setAuthor] = useState<Author | null>(null);
  const [authorState, setAuthorState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);
  const name = author?.name ?? '';
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
    let alive = true;
    setAuthor(null);
    setAuthorState('loading');
    fetchAuthor(type as StageAuthorType, id)
      .then((d) => {
        if (!alive) return;
        setAuthor(d.author);
        setAuthorState('ready');
      })
      .catch((e: unknown) => alive && setAuthorState(errorStatus(e) === 404 ? 'missing' : 'error'));
    return () => {
      alive = false;
    };
  }, [type, id]);

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

  if (authorState === 'missing') {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navigation />
        <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
          <EmptyState
            icon={Music4}
            title="We couldn't find this member"
            hint="The profile may have been removed, or the link is wrong."
            action={{ label: 'Back to the Stage', to: '/stage' }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
        <header className="flex items-center gap-4">
          {author ? (
            <UserAvatar id={author.id} name={author.name} size="lg" photoUrl={author.avatar} demo={author.demo} />
          ) : (
            <Skeleton className="size-16 rounded-full" />
          )}
          <div className="min-w-0 flex-1">
            {author ? (
              <h1 className="flex items-center gap-1.5 truncate text-2xl font-bold">
                {author.name}
                {author.verified && <ShieldCheck aria-hidden="true" size={18} className="text-emerald-400" />}
              </h1>
            ) : (
              <h1 className="text-2xl font-bold">
                {authorState === 'error' ? 'Stage profile' : <Skeleton className="h-7 w-40" />}
              </h1>
            )}
            {followersCount !== null && (
              <p className="text-sm text-slate-400">
                {followersCount} follower{followersCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
          {author && <FollowButton type={type as StageAuthorType} id={id} initialFollowing={following} />}
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
