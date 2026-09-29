import { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import type { AdminVerification } from '../../lib/apiTypes';
import { Panel, Pager, Empty, type AdminActions, type PageMeta } from './shared';
import { AdminPageHeader, HowToCallout } from './ui';

// What Admin::VerificationsController#update accepts for `checks` — kept in sync with
// VerificationRequest::CHECKS on the backend.
const CHECK_OPTIONS: { value: string; label: string }[] = [
  { value: 'identity', label: 'Identity' },
  { value: 'work_links', label: 'Work links' },
  { value: 'credits', label: 'Credits' },
  { value: 'organization', label: 'Organization' },
];

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
  const [approving, setApproving] = useState<AdminVerification | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const toggleCheck = (value: string) =>
    setChecks((current) => (current.includes(value) ? current.filter((c) => c !== value) : [...current, value]));
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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold">{v.companyName || v.name}</h2>
                {v.vouchedByName && (
                  <Badge className="bg-violet-500/15 text-violet-200">Vouched by {v.vouchedByName}</Badge>
                )}
              </div>
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
                onClick={() => {
                  setChecks([]);
                  setApproving(v);
                }}
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
      <Dialog open={Boolean(approving)} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent className="bg-slate-950 text-white border-white/15 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What did you check?</DialogTitle>
            <DialogDescription className="text-slate-400">
              Choose at least one. This is what the public Verified badge will say was checked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {CHECK_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={checks.includes(option.value)}
                  onChange={() => toggleCheck(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={!!busy || checks.length === 0}
              onClick={async () => {
                if (!approving) return;
                await patch(
                  `ver:${approving.id}`,
                  `/admin/verifications/${approving.id}`,
                  { status: 'approved', checks },
                  'Verification approved',
                );
                setApproving(null);
              }}
            >
              Approve with these checks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
