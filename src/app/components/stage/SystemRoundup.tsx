import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import type { StagePost } from '../../lib/stage';

const SHOWN = 4;

/** One card for a run of MusiLynk's own posts, so a quiet Stage is not a wall of near-identical updates. */
export function SystemRoundup({ posts }: { posts: StagePost[] }) {
  const shown = posts.slice(0, SHOWN);
  const more = posts.length - shown.length;
  return (
    <article
      aria-labelledby="stage-roundup"
      data-testid="system-roundup"
      className="verse-surface rounded-2xl border border-white/10 bg-white/[.03] p-4"
    >
      <h2 id="stage-roundup" className="flex items-center gap-2 text-sm font-semibold text-white">
        <Sparkles aria-hidden="true" size={15} className="text-violet-300" />
        This week on MusiLynk
      </h2>
      <ul className="mt-3 space-y-2">
        {shown.map((post) => (
          <li key={post.id} className="text-sm text-slate-300">
            <Link to={`/stage/posts/${encodeURIComponent(post.id)}`} className="hover:text-white hover:underline">
              {(post.body || post.event?.title || 'An update from MusiLynk').split('\n')[0]}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-2 text-xs text-slate-500">and {more} more</p>}
    </article>
  );
}
