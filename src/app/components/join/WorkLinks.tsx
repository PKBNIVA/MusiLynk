import { useRef, useState } from 'react';
import { Link2, Loader2, Music, Play, Plus, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { errorMessage, errorStatus } from '../../lib/errors';
import {
  MAX_LINKS,
  fetchLinkPreview,
  localPreview,
  normalizeLink,
  previewTitle,
  type LinkPreview,
} from '../../lib/onboarding';

export interface WorkLink {
  url: string;
  preview: LinkPreview;
  loading: boolean;
}

/**
 * "Paste links to your work": pasting (or typing and pressing Enter) adds a link and fetches its
 * preview (title, channel, thumbnail) from POST /api/link-previews. Up to MAX_LINKS.
 */
export function WorkLinks({ links, onChange }: { links: WorkLink[]; onChange: (next: WorkLink[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  // The latest list, for preview answers that arrive after other edits.
  const latest = useRef(links);
  latest.current = links;
  const update = (next: WorkLink[]) => {
    latest.current = next;
    onChange(next);
  };

  function add(raw: string) {
    const url = normalizeLink(raw);
    if (!url) {
      setError('That doesn’t look like a web link. Copy it from the app’s Share button and paste it here.');
      return false;
    }
    if (latest.current.some((link) => link.url === url)) {
      setError('You’ve already added that link.');
      return false;
    }
    if (latest.current.length >= MAX_LINKS) {
      setError(`You can add ${MAX_LINKS} links now, and more from your portfolio later.`);
      return false;
    }
    setError('');
    setDraft('');
    update([...latest.current, { url, preview: localPreview(url), loading: true }]);
    fetchLinkPreview(url)
      .then((preview) => {
        update(latest.current.map((link) => (link.url === url ? { url, preview, loading: false } : link)));
        setAnnouncement(`Added ${previewTitle(preview)}.`);
      })
      .catch((caught: unknown) => {
        if (errorStatus(caught) === 422) {
          update(latest.current.filter((link) => link.url !== url));
          setError(errorMessage(caught, 'That link can’t be used. Try another.'));
          return;
        }
        // The preview service is down or slow: keep the link, just without its details.
        update(latest.current.map((link) => (link.url === url ? { ...link, loading: false } : link)));
        setAnnouncement(`Added ${previewTitle(localPreview(url))}.`);
      });
    return true;
  }

  const remove = (url: string) => {
    const removed = latest.current.find((link) => link.url === url);
    update(latest.current.filter((link) => link.url !== url));
    if (removed) setAnnouncement(`Removed ${previewTitle(removed.preview)}.`);
  };

  const full = links.length >= MAX_LINKS;
  return (
    <div>
      <label htmlFor="join-link" className="block text-sm font-medium text-slate-200">
        Paste links to your work
      </label>
      <p id="join-link-hint" className="mt-1 text-xs text-slate-400">
        YouTube, Instagram, SoundCloud or Spotify. Up to {MAX_LINKS}. Your best one first.
      </p>
      <div className="mt-2 flex gap-2">
        <Input
          id="join-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={draft}
          disabled={full}
          placeholder={full ? 'That’s five: add more later' : 'https://youtube.com/watch?v=…'}
          aria-describedby={['join-link-hint', error ? 'join-link-error' : ''].filter(Boolean).join(' ')}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError('');
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (text && normalizeLink(text) && !draft.trim()) {
              event.preventDefault();
              add(text);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
          className="border-white/15 bg-black/20"
        />
        <Button type="button" variant="outline" onClick={() => add(draft)} disabled={full || !draft.trim()}>
          <Plus aria-hidden="true" size={16} />
          Add link
        </Button>
      </div>
      {error && (
        <p id="join-link-error" role="alert" className="mt-2 text-sm text-rose-300">
          {error}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {links.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Your work links">
          {links.map((link) => (
            <LinkCard key={link.url} link={link} onRemove={() => remove(link.url)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkCard({ link, onRemove }: { link: WorkLink; onRemove: () => void }) {
  const { preview } = link;
  const title = previewTitle(preview);
  const Icon = preview.kind === 'video' ? Play : preview.kind === 'audio' ? Music : Link2;
  return (
    <li
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-2.5"
      data-testid="work-link"
    >
      {preview.thumbnail ? (
        <img
          src={preview.thumbnail}
          alt=""
          width={96}
          height={54}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-[54px] w-24 shrink-0 rounded-lg bg-white/5 object-cover"
        />
      ) : (
        <span className="grid h-[54px] w-24 shrink-0 place-items-center rounded-lg bg-white/[.06] text-teal-200">
          <Icon aria-hidden="true" size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{title}</span>
        <span className="block truncate text-xs text-slate-400">
          {link.loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 aria-hidden="true" size={12} className="animate-spin" />
              Getting details…
            </span>
          ) : (
            [preview.label, preview.author].filter(Boolean).join(' · ')
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${title}`}
        className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden="true" size={17} />
      </button>
    </li>
  );
}
