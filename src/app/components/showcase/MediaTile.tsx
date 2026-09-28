import { ExternalLink } from 'lucide-react';
import { describeWorkSample, WorkSampleMediaView } from '../WorkSamplePlayer';
import type { PortfolioItem } from '../../lib/apiTypes';

/** A work sample's player (or thumbnail), or an "Open" link for plain web links. */
export function MediaTile({ item }: { item: PortfolioItem }) {
  const media = describeWorkSample(item.url, item.mediaMetadata?.contentType || undefined);
  if ((!media || media.kind === 'link') && !item.thumbnailUrl) {
    let host = '';
    try {
      host = new URL(item.url).hostname.replace(/^www\./, '');
    } catch {
      host = 'link';
    }
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-violet-200 hover:bg-white/5"
      >
        <ExternalLink size={15} aria-hidden="true" />
        <span className="truncate">Open on {host}</span>
        <span className="sr-only">: {item.title} (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
      <WorkSampleMediaView sample={item} />
    </div>
  );
}
