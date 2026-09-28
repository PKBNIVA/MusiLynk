import { Check, X } from 'lucide-react';
import { apiPatch } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { Job } from '../../lib/apiTypes';
import { Panel, Pager, Empty, type AdminActions, type PageMeta } from './shared';

export default function QueueTab({
  jobs,
  error,
  loading,
  retry,
  actions,
  meta,
  onPage,
}: {
  jobs: Job[];
  error?: string;
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  const { busy, patch, act, setConfirm } = actions;
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      {jobs.length === 0 && <Empty text="No opportunities waiting for review." />}
      {jobs.map((j) => (
        <Card key={j.id} className="bg-white/[.05] border-white/10">
          <CardContent className="p-5">
            <div className="flex flex-col xl:flex-row gap-5 justify-between">
              <div className="max-w-4xl min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{j.opportunity_kind || 'job'}</Badge>
                  <h2 className="font-semibold text-lg break-words">{j.title}</h2>
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
                  {j.salary || `${j.currency || 'INR'} ${j.compensation_min || '?'}–${j.compensation_max || '?'}`}
                </div>
                {j.moderation_note && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-400/20 p-3 text-sm text-amber-200">
                    Automated review hints: {j.moderation_note}
                  </div>
                )}
              </div>
              <div className="flex xl:flex-col gap-2 shrink-0">
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
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      <Pager meta={meta} onPage={onPage} loading={loading} />
    </Panel>
  );
}
