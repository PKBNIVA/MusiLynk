import { History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import type { AuditLogEntry } from '../../lib/apiTypes';
import { Panel, Pager, Empty, date, type PageMeta } from './shared';
import { AdminPageHeader, HowToCallout } from './ui';

export default function AuditTab({
  logs,
  error,
  loading,
  retry,
  meta,
  onPage,
}: {
  logs: AuditLogEntry[];
  error?: string;
  loading: boolean;
  retry: () => void;
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  return (
    <div>
      <AdminPageHeader
        icon={History}
        title="Audit trail"
        description="Every moderation action taken in this console, newest first, read-only."
      />
      <HowToCallout storageKey="audit">
        This log cannot be edited or deleted here — it exists to explain who did what, and when, if a decision is ever
        questioned.
      </HowToCallout>
      <Card className="bg-white/[.05] border-white/10">
        <CardHeader>
          <CardTitle>
            <h2>Recent activity</h2>
          </CardTitle>
        </CardHeader>
        <CardContent
          className="space-y-3 max-h-[700px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
          tabIndex={0}
          role="region"
          aria-label="Audit trail"
        >
          <Panel error={error} onRetry={retry} loading={loading}>
            {logs.map((l) => (
              <div key={l.id} className="border-b border-white/10 pb-3">
                <div className="text-sm">
                  <b>{l.actorName || 'System'}</b> · {l.action}
                </div>
                <div className="text-xs text-slate-400 mt-1 break-all">
                  {l.entity_type} {l.entity_id} · {date(l.created_at, true)}
                </div>
              </div>
            ))}
            {!logs.length && <Empty icon={History} text="No audit events yet." />}
            <Pager meta={meta} onPage={onPage} loading={loading} />
          </Panel>
        </CardContent>
      </Card>
    </div>
  );
}
