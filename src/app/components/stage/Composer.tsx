import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Music2, Link2, X, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { AppSelect } from '../ui/app-select';
import { AutocompleteInput } from '../ai/AutocompleteInput';
import { AiSuggestButton } from '../ai/AiSuggestButton';
import { errorMessage } from '../../lib/errors';
import { useUnsentDraft } from '../../lib/unsentDraft';
import { discardUpload, uploadContentType, uploadMedia, validateUploadFile } from '../../lib/api';
import {
  createPost,
  embedPreviewFor,
  rememberMediaUrl,
  useActingAs,
  POST_KIND_LABEL,
  type CreatePostPayload,
  type PostKind,
  type StageMedia,
  type StagePost,
} from '../../lib/stage';

const BODY_LIMIT = 3000;
const KIND_OPTIONS: { value: PostKind; label: string }[] = [
  { value: 'update', label: POST_KIND_LABEL.update },
  { value: 'performance', label: POST_KIND_LABEL.performance },
  { value: 'release', label: POST_KIND_LABEL.release },
  { value: 'gig', label: POST_KIND_LABEL.gig },
  { value: 'looking_for', label: POST_KIND_LABEL.looking_for },
];

type PendingMedia = StageMedia & { url: string; uploading?: boolean };

export interface ComposerProps {
  onPosted?: (post: StagePost) => void;
  /** Prefills a job or portfolio share; the composer still lets the person add a comment. */
  prefill?: { sharedJobId?: string; sharedPortfolioItemId?: string };
  /** Reshares an existing post instead of a fresh one. */
  reshareOf?: string;
  /** Smaller layout for dialogs (share-to-stage, reshare-with-comment). */
  compact?: boolean;
}

/**
 * The Stage's post composer: kind picker, caption with AI help, image/audio attachments,
 * a link with an embed preview, and genre/city chips. Posts as the signed-in person or, when
 * switched, the Page they're acting as (see `useActingAs` in lib/stage.ts).
 */
export function Composer({ onPosted, prefill, reshareOf, compact }: ComposerProps) {
  const { active, options, setActive, header } = useActingAs();
  const [kind, setKind] = useState<PostKind>('update');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [posting, setPosting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isShare = Boolean(prefill?.sharedJobId || prefill?.sharedPortfolioItemId || reshareOf);
  const embed = embedPreviewFor(linkUrl);
  const remaining = BODY_LIMIT - body.length;
  // A session that expires mid-post sends the person to sign in; the caption comes back with them.
  useUnsentDraft(
    'stage-composer',
    body,
    (text) => {
      setBody(text.slice(0, BODY_LIMIT));
      toast.message('We kept the text of your unsent post.');
    },
    !isShare && !compact,
  );

  async function onFilesPicked(files: FileList | null) {
    if (!files || !files.length) return;
    for (const file of Array.from(files).slice(0, 10 - media.length)) {
      try {
        validateUploadFile(file);
      } catch (e: unknown) {
        toast.error(errorMessage(e, 'That file cannot be uploaded. Choose a different file.'));
        continue;
      }
      const contentType = uploadContentType(file) || '';
      const type: StageMedia['type'] = contentType.startsWith('audio/') ? 'audio' : 'image';
      if (!contentType.startsWith('audio/') && !contentType.startsWith('image/')) {
        toast.error('The Stage takes images and audio here. Share video as a YouTube or Instagram link.');
        continue;
      }
      const placeholder: PendingMedia = {
        uploadId: `pending-${Date.now()}-${Math.random()}`,
        type,
        url: '',
        uploading: true,
      };
      setMedia((prev) => [...prev, placeholder]);
      try {
        const out = await uploadMedia(file);
        if (!out.id) throw new Error('Upload did not return an id.');
        rememberMediaUrl(out.id, out.url);
        const uploadId = out.id;
        setMedia((prev) =>
          prev.map((m) =>
            m.uploadId === placeholder.uploadId ? { ...m, uploadId, url: out.url, uploading: false } : m,
          ),
        );
      } catch (e: unknown) {
        toast.error(errorMessage(e, 'Upload failed.'));
        setMedia((prev) => prev.filter((m) => m.uploadId !== placeholder.uploadId));
      }
    }
  }

  async function removeMedia(uploadId: string) {
    setMedia((prev) => prev.filter((m) => m.uploadId !== uploadId));
    if (!uploadId.startsWith('pending-')) await discardUpload(uploadId).catch(() => undefined);
  }

  function reset() {
    setBody('');
    setLinkUrl('');
    setGenres([]);
    setCity([]);
    setMedia([]);
    setKind('update');
  }

  async function submit() {
    if (media.some((m) => m.uploading)) {
      toast.error('Wait for attachments to finish uploading.');
      return;
    }
    if (!body.trim() && !isShare) {
      toast.error('Write something before posting.');
      return;
    }
    setPosting(true);
    try {
      const payload: CreatePostPayload = {
        kind: reshareOf
          ? undefined
          : prefill?.sharedJobId
            ? 'job_share'
            : prefill?.sharedPortfolioItemId
              ? 'portfolio_share'
              : kind,
        body: body.trim() || undefined,
        media: isShare ? undefined : media.map(({ uploadId, type, caption }) => ({ uploadId, type, caption })),
        linkUrl: isShare ? undefined : linkUrl.trim() || undefined,
        city: city[0] || undefined,
        genres: genres.length ? genres : undefined,
        sharedJobId: prefill?.sharedJobId,
        sharedPortfolioItemId: prefill?.sharedPortfolioItemId,
        resharedPostId: reshareOf,
      };
      const { post } = await createPost(payload, header);
      toast.success('Posted to the Stage');
      reset();
      onPosted?.(post);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to post right now.'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <section
      aria-label={isShare ? 'Add a comment and share' : 'Create a post'}
      className={`musilynk-surface rounded-2xl border border-white/10 bg-white/[.04] p-4 ${compact ? '' : 'md:p-5'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-400">
          <span>Posting as</span>
          {options.length > 1 ? (
            <AppSelect
              value={active?.key || ''}
              onValueChange={setActive}
              options={options.map((o) => ({ value: o.key, label: o.name }))}
              className="h-8 w-auto min-w-36 text-xs"
              aria-label="Posting as"
            />
          ) : (
            <span className="font-medium text-slate-200">{active?.name || '…'}</span>
          )}
        </div>
        {!isShare && (
          <AppSelect
            value={kind}
            onValueChange={(v) => setKind(v as PostKind)}
            options={KIND_OPTIONS}
            className="h-8 w-auto min-w-32 text-xs"
            aria-label="Post type"
          />
        )}
      </div>

      <div className="relative mt-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, BODY_LIMIT))}
          placeholder={isShare ? 'Add a comment (optional)…' : "What's happening in your music world?"}
          aria-label={isShare ? 'Add a comment' : 'Post text'}
          className="min-h-24 bg-black/20 border-white/10"
          maxLength={BODY_LIMIT}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
          <AiSuggestButton
            task="post_caption"
            value={body}
            getContext={() => ({ kind, notes: body })}
            onAccept={(text) => setBody(text.slice(0, BODY_LIMIT))}
          />
          <span aria-live="polite">{remaining} characters left</span>
        </div>
      </div>

      {!isShare && (
        <>
          {media.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attached media">
              {media.map((m) => (
                <li
                  key={m.uploadId}
                  className="relative flex h-16 w-16 items-center justify-center rounded-lg border border-white/10 bg-black/30"
                >
                  {m.uploading ? (
                    <Loader2 aria-hidden="true" className="animate-spin text-slate-400" size={18} />
                  ) : m.type === 'image' ? (
                    <img src={m.url} alt="" className="size-full rounded-lg object-cover" />
                  ) : (
                    <Music2 aria-hidden="true" className="text-violet-300" size={22} />
                  )}
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={() => removeMedia(m.uploadId)}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-slate-300 hover:text-white"
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Attach photo or audio"
              accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav"
              multiple
              className="sr-only"
              onChange={(e) => {
                void onFilesPicked(e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={media.length >= 10}
            >
              <ImagePlus aria-hidden="true" size={16} />
              Photo / audio
            </Button>
            <div className="flex min-w-40 flex-1 items-center gap-1.5">
              <Link2 aria-hidden="true" size={16} className="shrink-0 text-slate-500" />
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Link a video (YouTube, Instagram)…"
                aria-label="Link URL"
                className="w-full rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </div>
          {embed && (
            <div className="mt-2 aspect-video overflow-hidden rounded-lg border border-white/10">
              <iframe
                src={embed.embedUrl}
                title="Link preview"
                className="size-full"
                allow="encrypted-media; picture-in-picture"
                loading="lazy"
              />
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AutocompleteInput
              field="genres"
              label="Genres"
              values={genres}
              onChange={setGenres}
              placeholder="Add a genre…"
            />
            <AutocompleteInput
              field="cities"
              label="City"
              values={city}
              onChange={setCity}
              multiple={false}
              placeholder="City"
            />
          </div>
        </>
      )}

      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={submit} disabled={posting} aria-busy={posting}>
          {posting ? 'Posting…' : isShare ? 'Share to the Stage' : 'Post'}
        </Button>
      </div>
    </section>
  );
}
