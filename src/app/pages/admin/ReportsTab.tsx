import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import type { AdminReport } from '../../lib/apiTypes';
import {
  Panel,
  Pager,
  Empty,
  date,
  entityLink,
  type AdminActions,
  type PageMeta,
  type ReportFilters,
  REPORT_ENTITY_TYPES,
  REPORT_REASONS,
} from './shared';

export default function ReportsTab({
  reports,
  error,
  loading,
  retry,
  flaggedMessages,
  flaggedMessagesAvailable,
  actions,
  onReview,
  meta,
  onPage,
  filters,
  onFilter,
}: {
  reports: AdminReport[];
  error?: string;
  loading: boolean;
  retry: () => void;
  flaggedMessages: number;
  flaggedMessagesAvailable: boolean;
  actions: AdminActions;
  onReview: (id: string) => void;
  meta?: PageMeta;
  onPage: (page: number) => void;
  filters: ReportFilters;
  onFilter: (changes: Partial<ReportFilters>) => void;
}) {
  const { busy } = actions;
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      {flaggedMessagesAvailable && (
        <p className="text-sm text-slate-400 flex items-center gap-2" data-testid="flagged-messages">
          <AlertTriangle
            size={15}
            aria-hidden="true"
            className={flaggedMessages ? 'text-amber-300' : 'text-slate-500'}
          />
          {flaggedMessages} message{flaggedMessages === 1 ? '' : 's'} flagged for scam patterns in the last 30 days.
          Recipients see a safety notice; open a report to see flags in context.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3" data-testid="reports-filters">
        <div>
          <Label htmlFor="report-filter-status">Status</Label>
          <select
            id="report-filter-status"
            value={filters.status}
            onChange={(e) => onFilter({ status: e.target.value })}
            className="mt-1 h-9 rounded-md bg-slate-900 border border-white/15 px-2 text-sm"
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>
        <div>
          <Label htmlFor="report-filter-entity">Reported item</Label>
          <select
            id="report-filter-entity"
            value={filters.entityType}
            onChange={(e) => onFilter({ entityType: e.target.value })}
            className="mt-1 h-9 rounded-md bg-slate-900 border border-white/15 px-2 text-sm"
          >
            <option value="">All</option>
            {REPORT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'user' ? 'Person' : t === 'job' ? 'Opportunity' : t === 'act' ? 'Act' : 'Review'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="report-filter-reason">Reason</Label>
          <select
            id="report-filter-reason"
            value={filters.reason}
            onChange={(e) => onFilter({ reason: e.target.value })}
            className="mt-1 h-9 rounded-md bg-slate-900 border border-white/15 px-2 text-sm"
          >
            <option value="">All</option>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      {reports.length === 0 && <Empty text="No reports match these filters." />}
      {reports.map((r) => {
        const href = entityLink(r.entity_type, r.entity_id);
        return (
          <Card key={r.id} className="bg-white/[.05] border-white/10">
            <CardContent className="p-5 flex flex-col md:flex-row justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-semibold break-all">
                  {r.entity_type}
                  {r.entityTitle ? ` · ${r.entityTitle}` : ''} ·{' '}
                  {href ? (
                    <Link className="text-sky-300 underline underline-offset-4" to={href} target="_blank">
                      {r.entity_id}
                    </Link>
                  ) : (
                    r.entity_id
                  )}
                </h2>
                <div className="text-sm text-rose-300 mt-1">{r.reason}</div>
                {r.details && <p className="text-sm text-slate-300 mt-2">{r.details}</p>}
                <p className="text-xs text-slate-400 mt-2">
                  Reported by {r.reporterName || 'Unknown'} · {date(r.created_at, true)}
                  {r.status !== 'open' && ` · ${r.status}${r.action_taken ? ` (${r.action_taken})` : ''}`}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={() => onReview(r.id)}
                  aria-label={`Review report: ${r.reason}`}
                >
                  Review
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Pager meta={meta} onPage={onPage} loading={loading} />
    </Panel>
  );
}
