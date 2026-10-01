import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Navigation } from '../../components/Navigation';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { Link } from 'react-router';
import { PostCard } from '../../components/stage/PostCard';
import { fetchPost, type StagePost as StagePostType } from '../../lib/stage';
import { errorMessage, errorStatus } from '../../lib/errors';
import { usePageMeta } from '../../components/PageMeta';

/** One post on its own page — where `stage_applause` / `stage_comment` notifications link. */
export default function StagePostPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<StagePostType>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  usePageMeta(post ? `${post.author.name} on the Stage` : 'Post', post?.body || undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchPost(id);
      setPost(d.post);
    } catch (e: unknown) {
      setError({
        message: errorMessage(e, 'This post is no longer available. Go back to the Stage.'),
        status: errorStatus(e),
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-2xl px-4 pt-24 pb-16 md:px-6">
        {loading && <Skeleton className="h-48 rounded-2xl" />}
        {!loading && (error || !post) && (
          <div role="alert" className="rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center">
            <h1 className="text-xl font-semibold">
              {error?.status === 404 ? "This post isn't available" : "We couldn't load this post"}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {error?.status === 404 ? 'It may have been removed or made private.' : error?.message}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
              <Button asChild>
                <Link to="/stage">Back to the Stage</Link>
              </Button>
            </div>
          </div>
        )}
        {!loading && post && <PostCard post={post} onChanged={setPost} onDeleted={() => navigate('/stage')} />}
      </main>
    </div>
  );
}
