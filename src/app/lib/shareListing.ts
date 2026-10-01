import { toast } from 'sonner';

/** The public address of an opportunity (what a musician opens from a shared link). */
export const listingUrl = (id: string) => `${window.location.origin}/opportunities/${encodeURIComponent(id)}`;

/**
 * Shares an opportunity: the phone's share sheet where there is one, otherwise the link is copied.
 * A cancelled share sheet is not an error.
 */
export async function shareListing(job: { id: string; title: string }): Promise<void> {
  const url = listingUrl(job.id);
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: job.title, url });
      return;
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied. Send it to musicians you know.');
  } catch {
    toast.info(url);
  }
}
