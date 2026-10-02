import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { FEATURE_STAGE } from '../../lib/features';
import { formatDate } from '../../lib/format';
import { loadStageTeaser, type StageTeaserPost } from '../../lib/landing';

/** Fewer than this many posts and the row would look empty, so it is left out. */
const MIN_SHOWN = 3;

/**
 * "From The Stage": the three newest public-safe posts by MusiLynk itself, from the public Stage
 * author route. Renders nothing when the Stage is switched off, under three posts, or on failure.
 */
export function StageTeaser() {
  const [posts, setPosts] = useState<StageTeaserPost[]>([]);
  useEffect(() => {
    if (!FEATURE_STAGE) return;
    let live = true;
    loadStageTeaser()
      .then((found) => live && setPosts(found))
      .catch(() => live && setPosts([]));
    return () => {
      live = false;
    };
  }, []);

  if (posts.length < MIN_SHOWN) return null;
  return (
    <section aria-labelledby="stage-teaser-title" className="px-4 pb-16 sm:px-6 md:pb-20" data-testid="stage-teaser">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="stage-teaser-title" className="text-2xl font-black md:text-3xl">
            Latest from The Stage
          </h2>
          <Link
            to="/stage"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-200 underline-offset-4 hover:text-white hover:underline"
          >
            See more on The Stage
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {posts.map((post) => (
            <li
              key={post.id}
              className="verse-surface flex flex-col gap-2 rounded-2xl p-4"
              data-testid="stage-teaser-post"
            >
              <p className="leading-7 text-slate-100">{post.body}</p>
              <p className="text-xs text-slate-400">MusiLynk · {formatDate(post.createdAt)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
