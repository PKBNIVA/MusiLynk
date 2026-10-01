import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Copy, Pencil, Share2, Users, XCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { useConfirm } from './booking/BookingDialogs';
import { jobStatusLabel } from './OpportunityPipeline';
import { apiPatch, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { shareListing } from '../lib/shareListing';
import type { Job } from '../lib/apiTypes';

const STATUS_COPY: Record<string, string> = {
  draft: 'Only you can see this draft. Submit it for review when it is ready.',
  pending: 'We review every listing within 24 hours, then it goes live. You can edit it any time.',
  published: 'Live: musicians can find it and apply.',
  rejected: 'We asked for changes before it can go live. Edit it and send it back.',
  closed: 'Closed: it no longer takes applications. Reopen it from Your opportunities.',
};
const statusClass: Record<string, string> = {
  published: 'bg-emerald-500/15 text-emerald-300',
  pending: 'bg-sky-500/15 text-sky-200',
  draft: 'bg-slate-500/20 text-slate-200',
  rejected: 'bg-amber-500/15 text-amber-200',
  closed: 'bg-slate-700/40 text-slate-400',
};

/** What a poster sees on their own opportunity instead of the apply panel: status, applicants, and the four actions (J-12). */
export function OwnerJobPanel({
  job,
  base,
  onChanged,
}: {
  job: Job;
  base: '/employer' | '/jobseeker';
  onChanged: () => unknown;
}) {
  const nav = useNavigate();
  const { ask, element: confirmDialog } = useConfirm();
  const [duplicating, setDuplicating] = useState(false);
  const applicants = Number(job.applicationsCount ?? job.applications ?? 0);
  const editPath = `${base}${base === '/employer' ? '/post-job' : '/hiring/post'}?edit=${encodeURIComponent(job.id)}`;
  const applicantsPath = `${base}${base === '/employer' ? '/applications' : '/hiring/applicants'}?jobId=${encodeURIComponent(job.id)}`;

  // A copy goes to drafts without dates (they would be stale) and opens for editing.
  async function duplicate() {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const copy = await apiPost<{ id: string }>('/jobs', {
        status: 'draft',
        title: `${job.title} (copy)`.slice(0, 120),
        company: job.company,
        location: job.location,
        type: job.kind,
        genre: job.genre,
        description: job.description,
        requirements: job.requirements,
        experienceLevel: job.experience_level,
        opportunityKind: job.opportunity_kind,
        functionArea: job.function_area,
        workplace: job.workplace,
        compensationMin: job.compensation_min,
        compensationMax: job.compensation_max,
        compensationPeriod: job.compensation_period,
        currency: job.currency,
        paid: job.paid,
        duration: job.duration,
        portfolioRequired: job.portfolioRequired ?? job.portfolio_required,
        slots: job.slots,
        skills: job.skills,
        languages: job.languages,
        screeningQuestions: job.screeningQuestions ?? job.screening_questions,
        ...(job.postedAs ? { actingAs: `${job.postedAs.type}:${job.postedAs.id}` } : {}),
      });
      toast.success('Copied to your drafts');
      nav(`${editPath.split('?')[0]}?edit=${encodeURIComponent(copy.id)}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to copy this opportunity.'));
    } finally {
      setDuplicating(false);
    }
  }
  const close = () =>
    ask({
      title: 'Close this opportunity?',
      description: `“${job.title}” stops accepting applications and leaves search. You can reopen it later; reopening sends it back to review.`,
      confirmLabel: 'Close opportunity',
      destructive: true,
      action: async () => {
        await apiPatch(`/employer/jobs/${job.id}`, { status: 'closed' });
        toast.success('Opportunity closed');
        await onChanged();
      },
    });

  return (
    <div data-testid="owner-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Badge data-testid="owner-status" className={statusClass[job.status] || ''}>
          {jobStatusLabel[job.status] || job.status}
        </Badge>
        <Link to={applicantsPath} className="inline-flex items-center gap-1.5 text-sm text-violet-200 hover:text-white">
          <Users aria-hidden="true" size={14} />
          {applicants} applicant{applicants === 1 ? '' : 's'}
        </Link>
      </div>
      <p className="mt-3 text-sm text-slate-300">{STATUS_COPY[job.status] || ''}</p>
      {job.status === 'rejected' && job.moderation_note && (
        <p className="mt-2 text-sm text-amber-200">Review note: {job.moderation_note}</p>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {job.status !== 'closed' && (
          <Button asChild variant="outline">
            <Link to={editPath}>
              <Pencil aria-hidden="true" size={15} className="mr-1.5" />
              Edit
            </Link>
          </Button>
        )}
        {job.status === 'published' && (
          <Button variant="outline" onClick={() => void shareListing(job)}>
            <Share2 aria-hidden="true" size={15} className="mr-1.5" />
            Share
          </Button>
        )}
        <Button variant="outline" disabled={duplicating} aria-busy={duplicating} onClick={() => void duplicate()}>
          <Copy aria-hidden="true" size={15} className="mr-1.5" />
          Duplicate
        </Button>
        {job.status !== 'closed' && (
          <Button variant="outline" className="text-rose-300" onClick={close}>
            <XCircle aria-hidden="true" size={15} className="mr-1.5" />
            Close
          </Button>
        )}
      </div>
      {applicants > 0 && (
        <Button asChild className="mt-3 w-full">
          <Link to={applicantsPath}>Review applicants</Link>
        </Button>
      )}
      {confirmDialog}
    </div>
  );
}
