import { Link } from 'react-router';
import { PublicNav } from './PublicNav';
import { Button } from './ui/button';
import { usePageMeta } from './PageMeta';

type Props = {
  loading: boolean;
  error?: { message: string; status?: number } | null;
  noun: string;
  backTo: string;
  backLabel: string;
  onRetry: () => void;
};

/** Loading / not-found / failure screen shared by the public detail pages. */
export function PublicDetailState({ loading, error, noun, backTo, backLabel, onRetry }: Props) {
  const missing = !loading && (error?.status === 404 || error?.status === 400);
  usePageMeta(
    loading ? undefined : missing ? `${noun[0].toUpperCase()}${noun.slice(1)} not found` : `Unable to load ${noun}`,
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="px-5 py-20 text-center">
        {loading ? (
          <div role="status" aria-label={`Loading ${noun}`} className="mx-auto max-w-3xl text-left">
            {/* The shape of the page to come, so nothing jumps when it arrives. */}
            <div aria-hidden="true" className="animate-pulse">
              <div className="flex items-center gap-4">
                <div className="size-20 shrink-0 rounded-2xl bg-white/[.08]" />
                <div className="flex-1 space-y-3">
                  <div className="h-7 w-2/3 rounded bg-white/[.08]" />
                  <div className="h-4 w-1/2 rounded bg-white/[.06]" />
                </div>
              </div>
              <div className="mt-8 space-y-3">
                <div className="h-4 w-full rounded bg-white/[.06]" />
                <div className="h-4 w-11/12 rounded bg-white/[.06]" />
                <div className="h-4 w-3/4 rounded bg-white/[.06]" />
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <div className="h-24 rounded-2xl bg-white/[.05]" />
                <div className="h-24 rounded-2xl bg-white/[.05]" />
              </div>
            </div>
            <span className="sr-only">Loading {noun}…</span>
          </div>
        ) : missing ? (
          <div>
            <h1 className="text-3xl font-bold">This {noun} isn’t available</h1>
            <p className="text-slate-400 mt-3">It may have been removed, filled or made private.</p>
            <Button className="mt-6" asChild>
              <Link to={backTo}>{backLabel}</Link>
            </Button>
          </div>
        ) : (
          <div role="alert">
            <h1 className="text-3xl font-bold">We couldn’t load this {noun}</h1>
            <p className="text-rose-300 mt-3">{error?.message || 'Something went wrong.'}</p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
              <Button variant="ghost" asChild>
                <Link to={backTo}>{backLabel}</Link>
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
