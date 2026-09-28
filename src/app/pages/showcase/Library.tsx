import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  FileAudio,
  Filter,
  Inbox,
  Layers,
  Pencil,
  Plus,
  Search,
  Star,
  Tags,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { AppSelect } from '../../components/ui/app-select';
import { EmptyState } from '../../components/help/EmptyState';
import { StepForm, focusStepHeading } from '../../components/help/StepForm';
import { Field } from '../../components/form/Field';
import { AutocompleteInput } from '../../components/ai/AutocompleteInput';
import { AiSuggestButton } from '../../components/ai/AiSuggestButton';
import { WorkSamplePlayer, describeWorkSample } from '../../components/WorkSamplePlayer';
import { MediaTile } from '../../components/showcase/MediaTile';
import { ChipInput, LoadState, Panel, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiDelete, apiGet, apiPatch, apiPost, uploadContentType, uploadMedia, UPLOAD_ACCEPT } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useActingAsKey } from '../../lib/actingAs';
import { announceSuggestionsChanged, syncSummary, type Portfolio, type Suggestion } from '../../lib/showcase';
import type { MediaMetadata, PortfolioItem } from '../../lib/apiTypes';

const KINDS = [
  { value: 'audio', label: 'Audio / track' },
  { value: 'video', label: 'Video' },
  { value: 'live', label: 'Live performance' },
  { value: 'showreel', label: 'Showreel' },
  { value: 'composition', label: 'Composition' },
  { value: 'production', label: 'Production' },
  { value: 'mix', label: 'Mix' },
  { value: 'master', label: 'Master' },
  { value: 'technical', label: 'Technical / show work' },
  { value: 'credit', label: 'Credit' },
  { value: 'project', label: 'Project' },
  { value: 'other', label: 'Other' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label || k;

type Form = {
  type: string;
  title: string;
  url: string;
  description: string;
  roles: string[];
  genres: string[];
  instruments: string[];
  tags: string[];
  creditedAs: string;
  year: string;
  featured: boolean;
  visibility: string;
  mediaMetadata: MediaMetadata;
};
const BLANK: Form = {
  type: 'audio',
  title: '',
  url: '',
  description: '',
  roles: [],
  genres: [],
  instruments: [],
  tags: [],
  creditedAs: '',
  year: '',
  featured: false,
  visibility: 'public',
  mediaMetadata: {},
};
const STEPS = ['work', 'tags'] as const;

function toForm(i: PortfolioItem): Form {
  return {
    type: i.type || i.kind,
    title: i.title,
    url: i.url,
    description: i.description || '',
    roles: i.roles || [],
    genres: i.genres || [],
    instruments: i.instruments || [],
    tags: i.tags || [],
    creditedAs: i.creditedAs || '',
    year: i.year ? String(i.year) : '',
    featured: Boolean(i.featured),
    visibility: i.visibility || 'public',
    mediaMetadata: i.mediaMetadata || {},
  };
}

export default function Library() {
  const base = useWorkspaceBase();
  const actingAs = useActingAsKey();
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [result, setResult] = useState<{ title: string; text: string; pending: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PortfolioItem | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [facet, setFacet] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadPortfolios = useCallback(
    () =>
      apiGet<{ portfolios?: Portfolio[] }>('/portfolios')
        .then((d) => {
          const list = d.portfolios || [];
          setPortfolios(list);
          return list;
        })
        .catch(() => [] as Portfolio[]),
    [],
  );
  const load = useCallback(() => {
    setError('');
    apiGet<{ items?: PortfolioItem[] }>('/portfolio')
      .then((d) => {
        const list = d.items || [];
        setItems(list);
        if (!list.length) setOpen(true);
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Your work could not be loaded.')));
    void loadPortfolios();
  }, [loadPortfolios]);
  useEffect(() => {
    load();
  }, [load, actingAs]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };
  const facets = useMemo(
    () =>
      Array.from(
        new Set((items || []).flatMap((i) => [...(i.roles || []), ...(i.genres || []), ...(i.instruments || [])])),
      ).slice(0, 14),
    [items],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((i) => {
      if (kind && (i.type || i.kind) !== kind) return false;
      const words = [...(i.roles || []), ...(i.genres || []), ...(i.instruments || []), ...(i.tags || [])];
      if (facet && !words.includes(facet)) return false;
      return !q || [i.title, i.description || '', ...words].join(' ').toLowerCase().includes(q);
    });
  }, [items, query, kind, facet]);
  const usage = (id: string) => portfolios.filter((p) => (p.itemIds || []).includes(id)).length;

  function startAdd() {
    setEditId(null);
    setForm(BLANK);
    setErrors({});
    setStep(0);
    setResult(null);
    setOpen(true);
    focusStepHeading('work');
  }
  function startEdit(i: PortfolioItem) {
    setEditId(i.id);
    setForm(toForm(i));
    setErrors({});
    setStep(0);
    setResult(null);
    setOpen(true);
    focusStepHeading('work');
  }
  function goTo(index: number) {
    if (index > step) {
      const missing: Record<string, string> = {};
      if (!form.title.trim()) missing.title = 'Give this work a title.';
      if (!form.url.trim()) missing.url = 'Paste a link or upload a file.';
      else if (!form.mediaMetadata?.uploadId && !/^https?:\/\//i.test(form.url))
        missing.url = 'Enter a full link starting with https://';
      if (Object.keys(missing).length) {
        setErrors(missing);
        document.getElementById(missing.title ? 'work-title' : 'work-url')?.focus();
        return;
      }
    }
    flushSync(() => setStep(index));
    focusStepHeading(STEPS[index]);
  }

  async function startUpload(file: File) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ name: file.name, pct: 0 });
    try {
      const out = await uploadMedia(file, {
        signal: controller.signal,
        onProgress: (pct) => setUpload({ name: file.name, pct }),
      });
      const contentType = out.contentType || uploadContentType(file) || '';
      setForm((f) => ({
        ...f,
        url: out.url,
        type: contentType.startsWith('video/')
          ? 'video'
          : contentType.startsWith('audio/')
            ? f.type
            : f.type === 'audio'
              ? 'project'
              : f.type,
        title: f.title || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
        mediaMetadata: { contentType, byteSize: out.byteSize || file.size, filename: file.name, uploadId: out.id },
      }));
      setErrors({});
    } catch (e: unknown) {
      if (!controller.signal.aborted) setErrors({ url: errorMessage(e, 'Upload failed. Try again.') });
    } finally {
      setUpload(null);
    }
  }

  async function save() {
    setSaving(true);
    const payload = {
      ...form,
      title: form.title.trim(),
      year: form.year ? Number(form.year) : null,
    };
    try {
      const out = editId
        ? await apiPatch<{ item: PortfolioItem }>(`/portfolio/${editId}`, payload)
        : await apiPost<{ id: string; item: PortfolioItem }>('/portfolio', payload);
      const saved = out.item;
      toast.success(editId ? 'Work updated' : 'Work added');
      setItems((list) =>
        editId ? (list || []).map((i) => (i.id === saved.id ? saved : i)) : [saved, ...(list || [])],
      );
      // Syncing runs on save: ask where the item landed and what now waits for review.
      const [lists, pending] = await Promise.all([
        loadPortfolios(),
        apiGet<{ suggestions?: Suggestion[] }>('/suggestions?status=pending')
          .then((d) => d.suggestions || [])
          .catch(() => [] as Suggestion[]),
      ]);
      const summary = syncSummary(saved.id, lists, pending);
      setResult({ title: saved.title, text: summary.text, pending: summary.pending });
      announceSuggestionsChanged();
      setOpen(false);
      setEditId(null);
      setForm(BLANK);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'This work could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item) return;
    try {
      await apiDelete(`/portfolio/${item.id}`);
      setItems((list) => (list || []).filter((i) => i.id !== item.id));
      toast.success('Work deleted');
      void loadPortfolios();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  const preview = form.url ? describeWorkSample(form.url, form.mediaMetadata?.contentType) : null;
  const uploaded = Boolean(form.mediaMetadata?.uploadId);
  const steps = [
    {
      id: 'work',
      title: 'The work',
      icon: FileAudio,
      description: 'What it is and where to hear or see it.',
      content: (
        <div className="space-y-4">
          <div>
            <label htmlFor="work-kind" className="text-sm font-medium text-slate-300">
              Kind of work
            </label>
            <AppSelect
              id="work-kind"
              className="mt-1.5"
              value={form.type}
              onValueChange={(v) => set('type', v)}
              options={KINDS}
              descriptions={false}
            />
          </div>
          <Field id="work-title" label="Title" required error={errors.title}>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Live at NH7 — Pune 2025"
              className="border-white/15 bg-black/20"
            />
          </Field>
          <Field
            id="work-url"
            label="Link"
            required
            error={errors.url}
            hint={
              uploaded
                ? `Uploaded: ${form.mediaMetadata.filename || 'file'}`
                : 'YouTube, Spotify, SoundCloud or any https link.'
            }
          >
            <Input
              type="url"
              value={uploaded ? '' : form.url}
              placeholder={uploaded ? 'Using the uploaded file' : 'https://'}
              readOnly={uploaded}
              onChange={(e) => set('url', e.target.value)}
              className="border-white/15 bg-black/20"
            />
          </Field>
          <div className="rounded-xl border border-dashed border-white/15 p-3 text-sm" aria-live="polite">
            {upload ? (
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate text-slate-300">
                  Uploading {upload.name} · {upload.pct}%
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                  <X size={14} aria-hidden="true" />
                  Cancel
                </Button>
              </div>
            ) : uploaded ? (
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span className="flex-1 truncate">{form.mediaMetadata.filename}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm((f) => ({ ...f, url: '', mediaMetadata: {} }))}
                >
                  Remove file
                </Button>
              </div>
            ) : (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-violet-200">
                <UploadCloud size={16} aria-hidden="true" />
                Or upload a file (MP3, WAV, MP4, image or PDF, up to 100 MB)
                <input
                  className="sr-only"
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = '';
                    if (file) void startUpload(file);
                  }}
                />
              </label>
            )}
          </div>
          {form.url && preview && preview.kind !== 'link' && (
            <div data-testid="work-preview">
              <p className="mb-1 text-xs text-slate-500">Preview</p>
              <WorkSamplePlayer
                sample={{
                  title: form.title || 'Preview',
                  url: form.url,
                  type: form.type,
                  mediaMetadata: form.mediaMetadata,
                }}
                compact
              />
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'tags',
      title: 'What you did',
      icon: Tags,
      description: 'Tags decide which portfolios this joins. Add what applies; skip the rest.',
      content: (
        <div className="space-y-4">
          <AutocompleteInput
            field="roles"
            label="Your role"
            values={form.roles}
            onChange={(v) => set('roles', v)}
            placeholder="Guitarist, Composer…"
          />
          <AutocompleteInput
            field="genres"
            label="Genres"
            values={form.genres}
            onChange={(v) => set('genres', v)}
            placeholder="Jazz, Bollywood…"
          />
          <AutocompleteInput
            field="instruments"
            label="Instruments"
            values={form.instruments}
            onChange={(v) => set('instruments', v)}
            placeholder="Guitar, Vocals…"
          />
          <ChipInput
            label="Tags"
            values={form.tags}
            onChange={(v) => set('tags', v)}
            placeholder="live, original, studio…"
          />
          <Field id="work-description" label="Description" optional>
            <Textarea
              value={form.description}
              maxLength={2000}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What did you do? What should a hirer notice?"
              className="min-h-24 border-white/15 bg-black/20"
            />
          </Field>
          <AiSuggestButton
            task="portfolio_blurb"
            value={form.description}
            getContext={() => ({ title: form.title, roles: form.roles, genres: form.genres, skills: form.instruments })}
            onAccept={(text) => set('description', text)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field id="work-credited" label="Credited as" optional>
              <Input
                value={form.creditedAs}
                onChange={(e) => set('creditedAs', e.target.value)}
                className="border-white/15 bg-black/20"
              />
            </Field>
            <Field id="work-year" label="Year" optional>
              <Input
                type="number"
                min={1900}
                max={2100}
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
                className="border-white/15 bg-black/20"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm">
              <input
                type="checkbox"
                className="accent-violet-400"
                checked={form.featured}
                onChange={(e) => set('featured', e.target.checked)}
              />
              <Star size={15} aria-hidden="true" />
              Feature this
            </label>
            <AppSelect
              aria-label="Who can see it"
              value={form.visibility}
              onValueChange={(v) => set('visibility', v)}
              options={['public', 'private']}
            />
          </div>
        </div>
      ),
    },
  ];

  return (
    <ShowcaseShell
      wide
      title="My work"
      description="Every track, video, credit and show, entered once. Your portfolios pick from here."
      help={SHOWCASE_HELP.library}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to={`${base}/portfolios`}>
              <Layers size={16} aria-hidden="true" />
              Portfolios
            </Link>
          </Button>
          <Button onClick={startAdd}>
            <Plus size={16} aria-hidden="true" />
            Add work
          </Button>
        </>
      }
    >
      {result && (
        <div
          role="status"
          data-testid="sync-result"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-teal-300/25 bg-teal-400/10 px-4 py-3 text-sm text-teal-50"
        >
          <CheckCircle2 size={18} aria-hidden="true" className="text-teal-300" />
          <span className="min-w-0 flex-1">
            <b>{result.title}</b> saved. {result.text}.
          </span>
          {result.pending > 0 && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`${base}/review`}>
                <Inbox size={14} aria-hidden="true" />
                Review
              </Link>
            </Button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setResult(null)}
            className="grid size-8 place-items-center rounded-full hover:bg-white/10"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={open ? 'grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]' : ''}>
        {open && (
          <Panel title={editId ? 'Edit work' : 'Add work'} icon={editId ? Pencil : Plus} className="h-fit">
            <StepForm steps={steps} current={step} reached={editId ? 1 : step} onStepChange={goTo} />
            <div className="mt-5 flex flex-wrap gap-2">
              {step > 0 && (
                <Button variant="outline" onClick={() => goTo(step - 1)}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  Back
                </Button>
              )}
              {step === 0 ? (
                <Button onClick={() => goTo(1)} disabled={Boolean(upload)}>
                  Next: what you did
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              ) : (
                <Button onClick={() => void save()} disabled={saving} aria-busy={saving}>
                  {saving ? 'Saving…' : editId ? 'Save changes' : 'Add to my work'}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </Panel>
        )}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end gap-3" role="search" aria-label="Filter my work">
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search my work</span>
              <Search size={16} aria-hidden="true" className="absolute left-3 top-3.5 text-slate-500" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles and tags"
                className="h-11 border-white/15 bg-black/20 pl-9"
              />
            </label>
            <AppSelect
              aria-label="Kind of work"
              className="w-44"
              value={kind}
              onValueChange={setKind}
              descriptions={false}
              options={[{ value: '', label: 'All kinds' }, ...KINDS]}
            />
          </div>
          {facets.length > 0 && (
            <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Filter by tag">
              <Filter size={16} aria-hidden="true" className="shrink-0 text-slate-500" />
              {facets.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={facet === f}
                  onClick={() => setFacet(facet === f ? '' : f)}
                  className={`min-h-9 shrink-0 rounded-full border px-3 text-xs ${facet === f ? 'border-violet-400/60 bg-violet-500/20 text-white' : 'border-white/15 text-slate-300 hover:border-white/30'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {items === null ? (
            <LoadState error={error} onRetry={load} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={FileAudio}
              title={items.length ? 'Nothing matches these filters' : 'Add your first piece of work'}
              action={
                items.length ? (
                  <Button variant="outline" onClick={() => (setQuery(''), setKind(''), setFacet(''))}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={startAdd}>
                    <Plus size={16} aria-hidden="true" />
                    Add work
                  </Button>
                )
              }
            >
              {items.length
                ? 'Try another word or kind.'
                : 'Three to six strong, different pieces are a great start. Each one can appear in many portfolios.'}
            </EmptyState>
          ) : (
            <ul className={`grid gap-4 ${open ? 'xl:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
              {visible.map((i) => {
                const used = usage(i.id);
                const words = [...(i.roles || []), ...(i.genres || []), ...(i.instruments || []), ...(i.tags || [])];
                return (
                  <li
                    key={i.id}
                    className="flex flex-col rounded-2xl border border-white/10 bg-white/[.055] p-4"
                    data-testid="library-item"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-violet-300">
                          {kindLabel(i.type || i.kind)}
                          {i.year ? ` · ${i.year}` : ''}
                        </p>
                        <h2 className="mt-0.5 font-semibold break-words">{i.title}</h2>
                      </div>
                      <div className="flex shrink-0">
                        {i.featured && <Star size={16} className="m-2 text-amber-300" aria-label="Featured" />}
                        {i.visibility === 'private' ? (
                          <EyeOff size={16} className="m-2 text-slate-500" aria-label="Private" />
                        ) : (
                          <Eye size={16} className="m-2 text-emerald-300" aria-label="Public" />
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <MediaTile item={i} />
                    </div>
                    {words.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {words.slice(0, 8).map((w) => (
                          <li
                            key={w}
                            className="rounded-full border border-white/10 bg-white/[.05] px-2 py-0.5 text-[11px] text-slate-300"
                          >
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                      <span className="text-xs text-slate-400">
                        <Layers size={13} aria-hidden="true" className="mr-1 inline" />
                        {used ? `In ${used} portfolio${used === 1 ? '' : 's'}` : 'In no portfolio yet'}
                      </span>
                      <span className="flex">
                        <Button size="icon" variant="ghost" aria-label={`Edit ${i.title}`} onClick={() => startEdit(i)}>
                          <Pencil size={16} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${i.title}`}
                          onClick={() => setPendingDelete(i)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="border-white/10 bg-slate-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              It leaves every portfolio that shows it. Applications you already sent keep their copy. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-500" onClick={() => void confirmDelete()}>
              Delete work
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ShowcaseShell>
  );
}
