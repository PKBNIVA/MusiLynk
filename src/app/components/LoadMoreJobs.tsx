import { Button } from './ui/button';

type Props = {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => Promise<number | null>;
};

/**
 * "Showing X of Y" plus a "Load more" button under a paged opportunity list.
 *
 * The count is a polite live region, so screen readers hear how many were added. After a page
 * loads, focus moves to the first new item (marked `data-job-item={index}` by the list), so
 * keyboard users continue where the new results start instead of back at the button.
 */
export function LoadMoreJobs({ shown, total, hasMore, loading, error, onLoadMore }: Props) {
  if (!shown) return null;
  const noun = total === 1 ? 'opportunity' : 'opportunities';

  async function loadMore() {
    const first = await onLoadMore();
    if (first === null) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-job-item="${first}"]`)?.focus();
    });
  }

  return (
    <div className="flex flex-col items-center gap-3 mt-8">
      <p className="text-sm text-slate-400" role="status" aria-live="polite">
        Showing {shown} of {Math.max(total, shown)} {noun}
      </p>
      {error && (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      {hasMore && (
        <Button variant="outline" onClick={loadMore} disabled={loading} aria-busy={loading}>
          {loading ? 'Loading…' : error ? 'Try again' : 'Load more opportunities'}
        </Button>
      )}
    </div>
  );
}
