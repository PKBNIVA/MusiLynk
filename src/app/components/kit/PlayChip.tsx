import { useState } from 'react';
import { Play } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { WorkSamplePlayer, describeWorkSample } from '../WorkSamplePlayer';
import type { PortfolioItem } from '../../lib/apiTypes';

const PROVIDERS: Record<string, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  audio: 'Audio',
  video: 'Video',
  image: 'Image',
  pdf: 'PDF',
};

export const truncateTitle = (title: string, max = 22) =>
  title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;

export function providerOf(sample: Pick<PortfolioItem, 'url' | 'mediaMetadata'>) {
  const media = describeWorkSample(sample.url, sample.mediaMetadata?.contentType || undefined);
  if (media && media.kind !== 'link') return PROVIDERS[media.kind];
  try {
    return new URL(sample.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

/** 32 px pill for one work sample. `onOpen` is called on click; use `PlayChip` for the built-in dialog. */
export function PlayChipButton({ sample, onOpen }: { sample: PortfolioItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Play ${sample.title}`}
      className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[.06] pl-2.5 pr-3 text-xs text-slate-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
    >
      {sample.thumbnailUrl ? (
        <img src={sample.thumbnailUrl} alt="" className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <Play aria-hidden="true" size={13} className="shrink-0 fill-current text-violet-300" />
      )}
      <span className="truncate">{truncateTitle(sample.title)}</span>
      <span className="shrink-0 text-slate-400">{providerOf(sample)}</span>
    </button>
  );
}

/** The chip plus its dialog: opens the existing WorkSamplePlayer. `onOpen` is an optional extra hook. */
export function PlayChip({ sample, onOpen }: { sample: PortfolioItem; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PlayChipButton
        sample={sample}
        onOpen={() => {
          setOpen(true);
          onOpen?.();
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{sample.title}</DialogTitle>
            <DialogDescription className="sr-only">Work sample player</DialogDescription>
          </DialogHeader>
          {open && <WorkSamplePlayer sample={sample} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
