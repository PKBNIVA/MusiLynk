import { Button } from './ui/button';

type Props = {
  shown: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => Promise<number | null>;
  /** [singular, plural]: "Showing 30 of 612 professionals", "Load more professionals". */
  noun: readonly [string, string];
  /** The attribute each list item carries with its index, e.g. "data-list-item". */
  itemAttribute?: string;
};

/**
 * "Showing X of Y" plus a "Load more" button under a paged list.
 *
 * The count is a polite live region, so screen readers hear how many were added. After a page
 * loads, focus moves to the first new item (marked `<itemAttribute>={index}` by the list), so
 * keyboard users continue where the new results start instead of back at the button.
 */
export function LoadMore({
  shown,
  total,
  hasMore,
  loading,
  error,
  onLoadMore,
  noun,
  itemAttribute = 'data-list-item',
}: Props) {
  if (!shown) return null;
  const [one, many] = noun;
  const count = Math.max(total, shown);

  async function loadMore() {
    const first = await onLoadMore();
    if (first === null) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[${itemAttribute}="${first}"]`)?.focus();
    });
  }

  return (
    <div className="flex flex-col items-center gap-3 mt-8">
      <p className="text-sm text-slate-400" role="status" aria-live="polite">
        Showing {shown} of {count} {count === 1 ? one : many}
      </p>
      {error && (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      {hasMore && (
        <Button variant="outline" onClick={loadMore} disabled={loading} aria-busy={loading}>
          {loading ? 'Loading…' : error ? 'Try again' : `Load more ${many}`}
        </Button>
      )}
    </div>
  );
}
