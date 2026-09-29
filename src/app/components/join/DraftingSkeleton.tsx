import { Loader2 } from 'lucide-react';

/** Shown while POST /api/link-import/draft is in flight, right where the review card will land. */
export function DraftingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-5 text-sm text-slate-300"
      data-testid="draft-skeleton"
    >
      <Loader2 aria-hidden="true" size={18} className="animate-spin text-violet-300" />
      Reading your links…
    </div>
  );
}
