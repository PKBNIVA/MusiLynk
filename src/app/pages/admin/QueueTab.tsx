import { Check, X, Briefcase } from 'lucide-react';
import { apiPatch } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { Job } from '../../lib/apiTypes';
import { Label } from '../../components/ui/label';
import {
  Panel,
  Pager,
  Empty,
  JOB_STATUS_OPTIONS,
  type AdminActions,
  type JobStatusFilter,
  type PageMeta,
} from './shared';
import { AdminPageHeader, AdminSelect, HowToCallout } from './ui';

export default function QueueTab({
  jobs,
  status,
  onStatus,
  error,
  loading,
  refreshing = false,
  retry,
  actions,
  meta,
  onPage,
}: {
  jobs: Job[];
  status: JobStatusFilter;
  onStatus: (status: JobStatusFilter) => void;
  error?: string;
  loading: boolean;
  /** A new page or filter is on its way; the previous list stays up but dimmed. */
  refreshing?: boolean;
  retry: () => void;
  actions: AdminActions;
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  const { busy, patch, act, setConfirm } = actions;
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      <AdminPageHeader
        icon={Briefcase}
        title="Opportunity queue"
        description="New job and gig posts, held for review before they go live to job seekers."
      />
      <HowToCallout storageKey="queue">
        <b>Approve</b> publishes the opportunity immediately. <b>Reject</b> asks for a reason, which is sent to the
        employer so they know what to change before reposting.
      </HowToCallout>
      <div>
        <Label htmlFor="queue-filter-status">Status</Label>
        <div className="mt-1 max-w-xs">
          <AdminSelect
            id="queue-filter-status"
            value={status}
            onChange={(v) => onStatus(v as JobStatusFilter)}
            options={JOB_STATUS_OPTIONS}
          />
        </div>
      </div>
      {jobs.length === 0 &&
        (status === 'pending' ? (
          <Empty icon={Briefcase} text="No opportunities waiting for review." hint="New posts will show up here." />
        ) : (
          <Empty
            icon={Briefcase}
            text="No opportunities with this status."
            hint="Switch the Status filter above to see other opportunities."
          />
        ))}
      <div aria-busy={refreshing} className={refreshing ? 'space-y-3 opacity-50 transition-opacity' : 'space-y-3'}>
        {jobs.map((j) => (
          <Card key={j.id} className="bg-white/[.05] border-white/10">
            <CardContent className="p-5">
              <div className="flex flex-col xl:flex-row gap-5 justify-between">
                <div className="max-w-4xl min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{j.opportunity_kind || 'job'}</Badge>
                    <h2 className="font-semibold text-lg break-words min-w-0">{j.title}</h2>
                    {status !== 'pending' && <Badge variant="outline">{j.status}</Badge>}
                    {j.employerVerified && (
                      <Badge className="bg-emerald-500/15 text-emerald-300">Verified employer</Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-400 mt-2">
                    {[j.company, j.location, j.workplace, j.type].filter(Boolean).join(' · ')}
                  </div>
                  <p className="text-sm text-slate-300 mt-3 line-clamp-3">{j.description}</p>
                  <div className="mt-3 text-sm">
                    <span className="text-slate-400">Compensation:</span>{' '}
                    {j.salary ||
                      (j.compensation_min || j.compensation_max
                        ? `${j.currency || 'INR'} ${j.compensation_min || '?'}–${j.compensation_max || '?'}`
                        : 'not disclosed')}
                  </div>
                  {j.moderation_note && (
                    <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-400/20 p-3 text-sm text-amber-200">
                      Automated review hints: {j.moderation_note}
                    </div>
                  )}
                </div>
                <div className="flex xl:flex-col gap-2 shrink-0">
                  {j.status !== 'published' && j.status !== 'closed' && (
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        patch(`job:${j.id}`, `/admin/jobs/${j.id}`, { status: 'published' }, 'Opportunity published')
                      }
                    >
                      <Check aria-hidden="true" size={15} className="mr-1" />
                      Approve
                    </Button>
                  )}
                  {j.status !== 'rejected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        setConfirm({
                          title: `Reject “${j.title}”?`,
                          description:
                            'The employer is notified and sees your reason. Be specific about what needs to change.',
                          confirmLabel: 'Reject opportunity',
                          reasonLabel: 'Reason / changes needed',
                          reasonRequired: true,
                          destructive: true,
                          run: (note) =>
                            act(
                              `job:${j.id}`,
                              () => apiPatch(`/admin/jobs/${j.id}`, { status: 'rejected', note }),
                              'Opportunity rejected',
                            ),
                        })
                      }
                    >
                      <X aria-hidden="true" size={15} className="mr-1" />
                      Reject
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Pager meta={meta} onPage={onPage} loading={loading} />
    </Panel>
  );
}
