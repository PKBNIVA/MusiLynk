import { UserCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import type { AdminVerification } from '../../lib/apiTypes';
import { Panel, Pager, Empty, type AdminActions, type PageMeta } from './shared';
import { AdminPageHeader, HowToCallout } from './ui';

export default function VerificationTab({
  verifications,
  error,
  loading,
  retry,
  actions,
  meta,
  onPage,
}: {
  verifications: AdminVerification[];
  error?: string;
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
  meta?: PageMeta;
  onPage: (page: number) => void;
}) {
  const { busy, patch } = actions;
  return (
    <Panel error={error} onRetry={retry} loading={loading}>
      <AdminPageHeader
        icon={UserCheck}
        title="Verification"
        description="Identity and company verification requests from employers and acts, waiting on a decision."
      />
      <HowToCallout storageKey="verification">
        Open the evidence link before deciding. Approving adds a verified badge visible to everyone on the public site;
        rejecting leaves the account unverified with no notice sent.
      </HowToCallout>
      {verifications.length === 0 && (
        <Empty icon={UserCheck} text="No verification requests waiting." hint="New requests will appear here." />
      )}
      {verifications.map((v) => (
        <Card key={v.id} className="bg-white/[.05] border-white/10">
          <CardContent className="p-5 flex flex-col md:flex-row justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-semibold">{v.companyName || v.name}</h2>
              <div className="text-sm text-slate-400 break-words">
                {v.email} · {v.role} · {v.kind}
              </div>
              {v.note && <p className="text-sm text-slate-300 mt-3">{v.note}</p>}
              {v.evidence_url && (
                <a
                  className="text-sm text-sky-300 mt-2 inline-block"
                  href={v.evidence_url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open evidence ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  patch(`ver:${v.id}`, `/admin/verifications/${v.id}`, { status: 'approved' }, 'Verification approved')
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  patch(`ver:${v.id}`, `/admin/verifications/${v.id}`, { status: 'rejected' }, 'Verification rejected')
                }
              >
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Pager meta={meta} onPage={onPage} loading={loading} />
    </Panel>
  );
}
