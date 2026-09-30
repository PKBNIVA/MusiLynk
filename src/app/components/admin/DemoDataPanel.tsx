import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, Trash2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatWhen } from '../../lib/format';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { errorMessage } from '../../lib/errors';

type Batch = {
  name: string;
  demo: boolean;
  visibility: 'public' | 'hidden';
  artists: number;
  employers: number;
  users: number;
  createdAt: string;
};
type Job = {
  id: string;
  kind: 'seed' | 'purge' | 'purge_all';
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  batch?: string;
  batches?: string[];
  size?: string;
  error?: string;
  // DemoDataSeedJob / DemoDataPurgeJob summaries: counts keyed by what was created or removed.
  result?: Record<string, number | string | boolean | null>;
  createdAt: string;
  updatedAt: string;
};
type Overview = {
  batches: Batch[];
  jobs: Job[];
  busy: boolean;
  demoUsers: number;
  maxUsers: number;
  showcaseBatch?: string;
  sizes: Record<string, { artists: number; employers: number }>;
};
type DeleteTarget = { kind: 'all' } | { kind: 'batch'; name: string; users: number };

const POLL_MS = 2000;
const SHOWCASE_BATCH = 'demo-showcase';
const FALLBACK_SIZES: Overview['sizes'] = {
  showcase: { artists: 110, employers: 40 },
  small: { artists: 20, employers: 8 },
  medium: { artists: 60, employers: 20 },
  large: { artists: 150, employers: 50 },
};
const PRESET_LABEL: Record<string, string> = { showcase: 'Showcase', small: 'Small', medium: 'Medium', large: 'Large' };
const PRESET_NOTE: Record<string, string> = {
  showcase: 'Hand-written: bios, audio samples, Stage posts, bookings and reviews',
  small: 'Generated sample accounts',
  medium: 'Generated sample accounts',
  large: 'Generated sample accounts',
};
const INCLUDED = [
  'Showcase: 110 musicians (60% in Mumbai, 33 Verified, 5 of them Verified Pro) with bios, rates, languages and labelled CC BY audio samples.',
  'Showcase: 40 hirers with company profiles, 45 opportunities, 8 urgent requests, 60 applications and 25 conversations.',
  'Showcase: 12 acts, 12 completed bookings with 18 reviews, and 40 Stage posts with reactions and comments.',
  'Small, Medium and Large: generated musicians, hirers and opportunities with templated text; no Stage posts or audio.',
  'Every account shows the Demo badge, and each batch can be deleted here in one click.',
];
const NOT_INCLUDED = [
  'Sign-in: nobody can log in to a demo account.',
  'Photos: the app draws art for demo people; no real person’s photo is used.',
  'Money and queues: no payments, subscriptions, reports, pending verification or review items.',
  'Email: demo addresses end in example.invalid and are never written to.',
  'Search engines and metrics: kept out of the sitemap, share pages, landing counters, funnel, digests, lifecycle e-mails, badges, system posts and review prompts.',
];

const active = (job?: Job) => job?.state === 'queued' || job?.state === 'running';
const label = (size?: string) => PRESET_LABEL[size ?? ''] ?? (size ? size[0].toUpperCase() + size.slice(1) : 'Demo');
const total = (size?: { artists: number; employers: number }) => (size ? size.artists + size.employers : 0);
const count = (value: unknown) => (typeof value === 'number' ? value : 0);

function describe(job: Job) {
  if (job.state === 'failed') return job.error || 'The job failed.';
  if (job.id === 'pending') return 'Sending request…';
  if (job.state !== 'succeeded') {
    if (job.kind === 'seed')
      return `Creating ${label(job.size).toLowerCase()} demo data${job.batch ? ` (${job.batch})` : ''}…`;
    return job.kind === 'purge' && job.batch ? `Deleting ${job.batch}…` : 'Deleting demo data…';
  }
  const r = job.result || {};
  if (job.kind === 'seed') {
    if (r.skipped) return `${job.batch ?? 'The showcase'} is already on the site; nothing changed.`;
    const extras = [
      count(r.acts) ? `${count(r.acts)} acts` : '',
      count(r.posts) ? `${count(r.posts)} Stage posts` : '',
      count(r.reviews) ? `${count(r.reviews)} reviews` : '',
    ].filter(Boolean);
    return `Demo data created: ${count(r.jobseekers)} musicians, ${count(r.employers)} hirers, ${count(r.jobs)} opportunities and ${count(r.bookings)} bookings${extras.length ? `, plus ${extras.join(', ')}` : ''}.`;
  }
  return `Demo data deleted: ${count(r.usersRemoved)} demo accounts and ${count(r.recordsRemoved)} records removed.`;
}

function useElapsed(job?: Job) {
  const [now, setNow] = useState(() => Date.now());
  const running = active(job);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running || !job?.createdAt) return '';
  const seconds = Math.max(0, Math.round((now - new Date(job.createdAt).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '';
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export default function DemoDataPanel() {
  const [data, setData] = useState<Overview>(),
    [error, setError] = useState(''),
    [submitting, setSubmitting] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [tracked, setTracked] = useState<string>();
  const [clicked, setClicked] = useState<string>();
  const announced = useRef<Set<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const d = await apiGet<Overview>('/admin/demo-data');
      setData(d);
      setError('');
      return d;
    } catch (e: unknown) {
      setError(errorMessage(e, 'Unable to load demo data status.'));
      return undefined;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const latest = data?.jobs?.[0];
  const trackedJob = data?.jobs?.find((j) => j.id === tracked);
  const busy = !!data?.busy || active(trackedJob) || submitting;

  useEffect(() => {
    if (!data?.busy && !active(trackedJob)) return;
    const t = window.setTimeout(() => {
      void load();
    }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [data, trackedJob, load]);
  useEffect(() => {
    if (!trackedJob || active(trackedJob) || announced.current.has(trackedJob.id)) return;
    announced.current.add(trackedJob.id);
    trackedJob.state === 'succeeded' ? toast.success(describe(trackedJob)) : toast.error(describe(trackedJob));
  }, [trackedJob]);

  const start = async (run: () => Promise<{ jobId: string }>) => {
    setSubmitting(true);
    setError('');
    try {
      const r = await run();
      setTracked(r.jobId);
      await load();
    } catch (e: unknown) {
      const msg = errorMessage(e, 'Request failed.');
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };
  const create = (size: string) => {
    setClicked(size);
    return start(() => apiPost<{ jobId: string }>('/admin/demo-data', { size }));
  };
  const confirmDelete = () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    void start(() =>
      target.kind === 'all'
        ? apiDelete<{ jobId: string }>('/admin/demo-data')
        : apiDelete<{ jobId: string }>(`/admin/demo-data/${encodeURIComponent(target.name)}`),
    );
  };

  const demoBatches = (data?.batches || []).filter((b) => b.demo),
    hiddenBatches = (data?.batches || []).filter((b) => !b.demo);
  // While a request is in flight, never show the previous job's result as if it were this one.
  const shown: Job | undefined = submitting
    ? { id: 'pending', kind: 'seed', state: 'queued', createdAt: '', updatedAt: '' }
    : tracked && !trackedJob
      ? undefined
      : trackedJob || latest;
  const elapsed = useElapsed(shown);
  // Only the preset that is actually being seeded spins; the others just stay disabled.
  const spinningSize =
    active(shown) && shown?.kind === 'seed' ? (shown.id === 'pending' ? clicked : shown.size) : undefined;
  const sizes = data?.sizes || FALLBACK_SIZES;
  const showcaseBatch = data?.showcaseBatch || SHOWCASE_BATCH;
  const showcaseExists = demoBatches.some((b) => b.name === showcaseBatch);
  const used = data?.demoUsers ?? 0;
  const cap = data?.maxUsers ?? 300;
  const presetBlocked = (size: string) => {
    if (size === 'showcase' && showcaseExists) return 'Already on the site. Delete it first to seed it again.';
    if (used + total(sizes[size]) > cap) return `Would go past the ${cap}-account limit. Delete some demo data first.`;
    return '';
  };
  const deleteCopy =
    deleteTarget?.kind === 'batch'
      ? `This permanently removes ${deleteTarget.name} (${deleteTarget.users} demo accounts) and everything linked to it, including any applications, messages, comments or shortlists real users made on its content. Real accounts are never deleted.`
      : `This permanently removes ${data?.demoUsers ?? 0} demo accounts in ${demoBatches.length} batch${demoBatches.length === 1 ? '' : 'es'} and everything linked to them, including any applications, messages or shortlists real users made on demo content. Real accounts are never deleted.`;

  return (
    <Card className="bg-white/[.05] border-amber-300/20 mb-6" data-testid="demo-data-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FlaskConical className="text-amber-300" size={20} />
          Demo data
        </CardTitle>
        <p className="text-sm text-slate-400">
          Fill the live site with sample musicians, hirers, opportunities, acts and bookings. Everything shows a “Demo”
          badge publicly, no one can sign in to these accounts, and each batch can be deleted in one click.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        {shown && (
          <div
            role="status"
            data-testid="demo-job-status"
            data-state={shown.state}
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${shown.state === 'failed' ? 'border-rose-300/30 bg-rose-500/10 text-rose-100' : shown.state === 'succeeded' ? 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100' : 'border-sky-300/30 bg-sky-500/10 text-sky-100'}`}
          >
            {active(shown) ? (
              <Loader2 size={16} className="mt-0.5 animate-spin shrink-0" />
            ) : shown.state === 'succeeded' ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            )}
            <span>
              {describe(shown)}
              {active(shown) && shown.id !== 'pending' && (
                <span className="ml-2 text-xs opacity-80" data-testid="demo-job-progress">
                  {shown.state === 'queued' ? 'Waiting to start' : 'Running'}
                  {elapsed ? ` · ${elapsed}` : ''}
                </span>
              )}
            </span>
          </div>
        )}

        <section aria-labelledby="demo-presets">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="demo-presets" className="text-sm font-semibold text-white">
              Create demo data
            </h3>
            {data && (
              <span className="text-xs text-slate-500">
                {used} of {cap} demo accounts used
              </span>
            )}
          </div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="demo-presets">
            {Object.entries(sizes).map(([key, size]) => {
              const blocked = presetBlocked(key);
              return (
                <div key={key} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[.03] p-3">
                  <Button
                    variant={key === 'showcase' ? 'default' : 'outline'}
                    onClick={() => void create(key)}
                    disabled={busy || !data || !!blocked}
                    title={blocked || undefined}
                    data-testid={`preset-${key}`}
                  >
                    {spinningSize === key ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    {label(key)} ({total(size)})
                  </Button>
                  <p className="text-xs text-slate-300">
                    {size.artists} musicians · {size.employers} hirers
                  </p>
                  <p className="text-xs text-slate-500">{blocked || PRESET_NOTE[key] || 'Generated sample accounts'}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="demo-scope" className="grid gap-4 md:grid-cols-2" data-testid="demo-scope">
          <div>
            <h3 id="demo-scope" className="text-sm font-semibold text-emerald-200">
              What is included
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-300">
              {INCLUDED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-amber-200">What is not included</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-300">
              {NOT_INCLUDED.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="demo-batches-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="demo-batches-heading" className="text-sm font-semibold text-white">
              Demo batches on the site
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="border-rose-300/40 text-rose-200 hover:bg-rose-500/10"
              onClick={() => setDeleteTarget({ kind: 'all' })}
              disabled={busy || !demoBatches.length}
            >
              <Trash2 size={15} />
              Delete all demo data
            </Button>
          </div>
          <div className="mt-2">
            {!data && !error ? (
              <p className="text-sm text-slate-400" role="status">
                Loading demo data…
              </p>
            ) : demoBatches.length ? (
              <ul className="divide-y divide-white/10 rounded-lg border border-white/10" data-testid="demo-batches">
                {demoBatches.map((b) => (
                  <li key={b.name} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                    <div>
                      <b className="font-mono">{b.name}</b>
                      <div className="text-xs text-slate-400">
                        Created {formatWhen(b.createdAt)} · public with Demo badge
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-300">
                        {b.artists} musicians · {b.employers} hirers
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-rose-300/40 text-rose-200 hover:bg-rose-500/10"
                        onClick={() => setDeleteTarget({ kind: 'batch', name: b.name, users: b.users })}
                        disabled={busy}
                        aria-label={`Delete ${b.name}`}
                      >
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No demo data on the site.</p>
            )}
            {hiddenBatches.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Hidden QA batches (not public, managed with the synthetic_qa rake tasks):{' '}
                {hiddenBatches.map((b) => `${b.name} (${b.users})`).join(', ')}
              </p>
            )}
          </div>
        </section>
      </CardContent>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-900 border-white/15 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === 'batch' ? `Delete ${deleteTarget.name}?` : 'Delete all demo data?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">{deleteCopy}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-500 text-white" onClick={confirmDelete}>
              {deleteTarget?.kind === 'batch' ? `Delete ${deleteTarget.name}` : 'Delete all demo data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
