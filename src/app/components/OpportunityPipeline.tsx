import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ApiError, apiGet, apiPatch } from '../lib/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { FormatGlyph } from './kit/FormatGlyph';
import { Info, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormDialog } from './HiringDialog';
import { errorMessage } from '../lib/errors';
import type { Job } from '../lib/apiTypes';

export const jobStatusLabel: Record<string, string> = {
  draft: 'Draft',
  pending: 'In review',
  published: 'Live',
  rejected: 'Changes requested',
  closed: 'Closed',
};
const statusClass: Record<string, string> = {
  published: 'bg-emerald-500/15 text-emerald-300',
  pending: 'bg-sky-500/15 text-sky-200',
  draft: 'bg-slate-500/20 text-slate-200',
  rejected: 'bg-amber-500/15 text-amber-200',
  closed: 'bg-slate-700/40 text-slate-400',
};

// Shows a plan-limit error with a way to the plans page instead of a dead end.
export function toastJobError(error: unknown, billingPath: string, nav: (to: string) => void) {
  if (error instanceof ApiError && error.status === 402) {
    toast.error(error.message, { action: { label: 'View plans', onClick: () => nav(billingPath) } });
  } else toast.error(errorMessage(error, 'Something went wrong. Try again.'));
}

// The poster's own opportunities with the actions their status allows (GET/PATCH /employer/jobs).
export function OpportunityPipeline({
  role,
  reloadKey = 0,
  onChanged,
  emptyHint,
  emptySlot,
}: {
  role?: string;
  reloadKey?: number;
  onChanged?: () => void;
  emptyHint?: string;
  /** Replaces the default empty box (the dashboard shows two choice cards instead). */
  emptySlot?: ReactNode;
}) {
  const nav = useNavigate();
  const seeker = role === 'jobseeker';
  const editBase = seeker ? '/jobseeker/hiring/post' : '/employer/post-job';
  const applicantsBase = seeker ? '/jobseeker/hiring/applicants' : '/employer/applications';
  const billingPath = seeker ? '/jobseeker/billing' : '/employer/billing';
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [closing, setClosing] = useState<Job | null>(null);

  const load = () =>
    apiGet<{ jobs?: Job[] }>('/employer/jobs')
      .then((d) => {
        setJobs(d.jobs || []);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Your opportunities could not be loaded.')))
      .finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, [reloadKey]);

  async function move(job: Job, status: string, success: string) {
    if (busy) return false;
    setBusy(job.id);
    try {
      await apiPatch(`/employer/jobs/${job.id}`, { status });
      toast.success(success);
      await load();
      onChanged?.();
      return true;
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 422 && status === 'pending') {
        toast.error(`${errorMessage(e)} Edit the opportunity to finish it.`, {
          action: { label: 'Edit', onClick: () => nav(`${editBase}?edit=${job.id}`) },
        });
      } else toastJobError(e, billingPath, nav);
      return false;
    } finally {
      setBusy('');
    }
  }

  if (loading)
    return (
      <p role="status" className="text-slate-400 py-6">
        Loading your opportunities…
      </p>
    );
  if (error)
    return (
      <Card className="bg-white/[.035] border-white/10">
        <CardContent className="p-6 text-center" role="alert">
          <p className="text-rose-300">{error}</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  if (!jobs.length && emptySlot) return <>{emptySlot}</>;
  if (!jobs.length)
    return (
      <Card className="bg-white/[.035] border-white/10">
        <CardContent className="p-8 text-center text-slate-400">
          <p>{emptyHint || 'You have not created any opportunities yet.'}</p>
          {!seeker && (
            <Button className="mt-4" variant="outline" asChild>
              <Link to={editBase}>Create your first opportunity</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      {jobs.map((j) => {
        const allowed: string[] = j.allowedNextStatuses || [];
        const applications = Number(j.applications ?? j.applicationsCount ?? 0);
        return (
          <Card key={j.id} className="bg-white/[.055] border-white/10" data-testid="pipeline-job">
            <CardContent className="p-5 flex flex-col md:flex-row justify-between gap-4 md:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <FormatGlyph kind={j.opportunity_kind} size={24} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 items-center">
                    <h3 className="font-semibold text-lg break-words">{j.title}</h3>
                    <Badge className={statusClass[j.status] || ''}>{jobStatusLabel[j.status] || j.status}</Badge>
                    <Badge variant="secondary" data-testid="pipeline-applicants">
                      {applications} applicant{applications === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">
                    {[j.opportunity_kind, j.location || 'Location to be added', j.workplace]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {j.moderation_note && (
                    <p
                      className={`mt-2 flex items-start gap-1.5 text-xs ${j.status === 'rejected' ? 'text-amber-300' : 'text-slate-400'}`}
                    >
                      <Info aria-hidden="true" size={13} className="mt-0.5 shrink-0" />
                      <span>Review note: {j.moderation_note}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 md:justify-end">
                {applications > 0 ? (
                  <Button size="sm" variant="secondary" asChild>
                    <Link to={`${applicantsBase}?jobId=${encodeURIComponent(j.id)}`}>Review applicants</Link>
                  </Button>
                ) : j.status === 'draft' && allowed.includes('pending') ? (
                  <Button
                    size="sm"
                    disabled={!!busy}
                    aria-busy={busy === j.id}
                    onClick={() => move(j, 'pending', 'Submitted for review')}
                  >
                    Submit for review
                  </Button>
                ) : j.status === 'closed' && allowed.includes('pending') ? (
                  <Button
                    size="sm"
                    disabled={!!busy}
                    aria-busy={busy === j.id}
                    onClick={() => move(j, 'pending', 'Reopened and submitted for review')}
                  >
                    Reopen
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" aria-label={`More actions for ${j.title}`}>
                      <MoreHorizontal aria-hidden="true" size={18} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {applications > 0 && j.status === 'draft' && allowed.includes('pending') && (
                      <DropdownMenuItem disabled={!!busy} onSelect={() => move(j, 'pending', 'Submitted for review')}>
                        Submit for review
                      </DropdownMenuItem>
                    )}
                    {applications > 0 && j.status === 'closed' && allowed.includes('pending') && (
                      <DropdownMenuItem
                        disabled={!!busy}
                        onSelect={() => move(j, 'pending', 'Reopened and submitted for review')}
                      >
                        Reopen
                      </DropdownMenuItem>
                    )}
                    {j.status !== 'closed' && (
                      <DropdownMenuItem asChild>
                        <Link to={`${editBase}?edit=${encodeURIComponent(j.id)}`} aria-label={`Edit ${j.title}`}>
                          Edit
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {j.status !== 'closed' && allowed.includes('closed') && (
                      <DropdownMenuItem
                        disabled={!!busy}
                        onSelect={() => setClosing(j)}
                        aria-label={`Close ${j.title}`}
                      >
                        Close
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <FormDialog
        open={!!closing}
        onOpenChange={(o) => {
          if (!o) setClosing(null);
        }}
        title="Close this opportunity?"
        description={
          closing
            ? `“${closing.title}” stops accepting applications and leaves search. You can reopen it later; reopening sends it back to review.`
            : undefined
        }
        submitLabel="Close opportunity"
        busy={!!busy}
        onSubmit={async () => {
          if (closing && (await move(closing, 'closed', 'Opportunity closed'))) setClosing(null);
        }}
      >
        <span className="sr-only">Confirm closing</span>
      </FormDialog>
    </div>
  );
}
