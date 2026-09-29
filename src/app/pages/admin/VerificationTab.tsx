import { useEffect, useState } from 'react';
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
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import type { AdminVerification, AdminVerificationStats, VerificationWindowStats } from '../../lib/apiTypes';
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

/** Score band colours: >= 75 green, 40-74 amber, < 40 (or not scored yet) grey. */
export function scoreBand(score: number | null | undefined): 'green' | 'amber' | 'grey' {
  if (typeof score !== 'number') return 'grey';
  if (score >= 75) return 'green';
  return score >= 40 ? 'amber' : 'grey';
}
const BAND_CLASS = {
  green: 'bg-emerald-500/15 text-emerald-200',
  amber: 'bg-amber-500/15 text-amber-200',
  grey: 'bg-slate-500/20 text-slate-300',
} as const;

const FLAG_LABELS: Record<string, string> = {
  duplicate_links: 'Duplicate links',
  disposable_email: 'Disposable email',
  velocity: 'Many requests',
  recently_reported: 'Reported',
};

/** The checks one-click Approve pre-selects from the breakdown: identity if the identity
 * component reaches 15, work links if links reach 10, credits if on-platform reaches 10. */
export function checksFromBreakdown(v: AdminVerification): string[] {
  const b = v.evidence_breakdown;
  const checks: string[] = [];
  if ((b?.identity?.score ?? 0) >= 15) checks.push('identity');
  if ((b?.links?.score ?? 0) >= 10) checks.push('work_links');
  if ((b?.community?.score ?? 0) >= 10) checks.push('credits');
  return checks;
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
function StatsLine({ label, stats }: { label: string; stats: VerificationWindowStats }) {
  return (
    <span>
      <b className="text-slate-200">{label}</b>: {stats.autoApproved} of {stats.total} auto-approved (
      {pct(stats.autoApprovalRate)}), {stats.auditSample} in audit sample
    </span>
  );
}

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
  const { busy, patch, act, setConfirm } = actions;
  const [view, setView] = useState<'queue' | 'audit'>('queue');
  const [stats, setStats] = useState<AdminVerificationStats | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<AdminVerificationStats>('/admin/verifications/stats')
      .then((d) => live && setStats(d))
      .catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, [verifications]);
  const queue = verifications.filter((v) => v.status === 'pending');
  const audit = verifications.filter((v) => v.audit_sample);
  const rows = view === 'audit' ? audit : queue;
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
        Strong evidence with a proven identity is approved automatically; nothing is ever rejected automatically. Open
        the evidence link before deciding on the rest. Approving adds a verified badge visible to everyone on the public
        site; rejecting leaves the account unverified and tells them your reason.
      </HowToCallout>
      {stats && (
        <p className="text-sm text-slate-400 flex flex-wrap gap-x-6 gap-y-1" data-testid="verification-stats">
          <StatsLine label="7 days" stats={stats.days7} />
          <StatsLine label="30 days" stats={stats.days30} />
        </p>
      )}
      <div className="flex gap-2" role="group" aria-label="Verification view">
        <Button
          size="sm"
          variant={view === 'queue' ? 'default' : 'outline'}
          aria-pressed={view === 'queue'}
          onClick={() => setView('queue')}
        >
          Queue ({queue.length})
        </Button>
        <Button
          size="sm"
          variant={view === 'audit' ? 'default' : 'outline'}
          aria-pressed={view === 'audit'}
          onClick={() => setView('audit')}
        >
          Audit sample ({audit.length})
        </Button>
      </div>
      {rows.length === 0 && (
        <Empty
          icon={UserCheck}
          text={view === 'audit' ? 'No audit-sample approvals to look at.' : 'No verification requests waiting.'}
          hint={
            view === 'audit'
              ? 'A share of automatic approvals lands here for a human look.'
              : 'New requests will appear here.'
          }
        />
      )}
      {rows.map((v) => {
        const band = scoreBand(v.evidence_score);
        const oneClick = checksFromBreakdown(v);
        return (
          <Card key={v.id} className="bg-white/[.05] border-white/10">
            <CardContent className="p-5 flex flex-col md:flex-row justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    className={BAND_CLASS[band]}
                    data-band={band}
                    aria-label={
                      typeof v.evidence_score === 'number'
                        ? `Evidence score ${v.evidence_score} out of 100`
                        : 'Not scored yet'
                    }
                  >
                    {typeof v.evidence_score === 'number' ? v.evidence_score : '—'}
                  </Badge>
                  <h2 className="font-semibold">{v.companyName || v.name}</h2>
                  {v.vouchedByName && (
                    <Badge className="bg-violet-500/15 text-violet-200">Vouched by {v.vouchedByName}</Badge>
                  )}
                  {v.auto_decision === 'auto_approved' && (
                    <Badge className="bg-emerald-500/15 text-emerald-200">Auto-approved</Badge>
                  )}
                  {v.auto_decision === 'needs_more_proof' && (
                    <Badge className="bg-slate-500/20 text-slate-300">Asked for more proof</Badge>
                  )}
                  {(v.flags ?? []).map((flag) => (
                    <Badge key={flag} className="bg-rose-500/15 text-rose-200" data-flag={flag}>
                      {FLAG_LABELS[flag] ?? flag}
                    </Badge>
                  ))}
                </div>
                <div className="text-sm text-slate-400 break-words">
                  {v.email} · {v.role} · {v.kind}
                </div>
                {v.summary && <p className="text-sm text-slate-200 mt-3 whitespace-pre-line">{v.summary}</p>}
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
              <div className="flex gap-2 shrink-0 flex-wrap items-start">
                {v.status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => {
                        if (oneClick.length > 0) {
                          void patch(
                            `ver:${v.id}`,
                            `/admin/verifications/${v.id}`,
                            { status: 'approved', checks: oneClick },
                            'Verification approved',
                          );
                          return;
                        }
                        setChecks([]);
                        setApproving(v);
                      }}
                    >
                      Approve
                    </Button>
                    {oneClick.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => {
                          setChecks(oneClick);
                          setApproving(v);
                        }}
                      >
                        Choose checks
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() =>
                        setConfirm({
                          title: `Reject ${v.companyName || v.name}?`,
                          description: 'They are notified and see your reason.',
                          confirmLabel: 'Reject',
                          reasonLabel: 'Reason',
                          reasonRequired: true,
                          destructive: true,
                          run: (reason) =>
                            act(
                              `ver:${v.id}`,
                              () => apiPatch(`/admin/verifications/${v.id}`, { status: 'rejected', reason }),
                              'Verification rejected',
                            ),
                        })
                      }
                    >
                      Reject
                    </Button>
                  </>
                )}
                {v.status === 'approved' && v.auto_decision === 'auto_approved' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      setConfirm({
                        title: `Revoke verification for ${v.companyName || v.name}?`,
                        description:
                          'The badge is removed (unless another approved request exists) and they are notified.',
                        confirmLabel: 'Revoke',
                        destructive: true,
                        run: () =>
                          act(
                            `ver:${v.id}`,
                            () => apiPost(`/admin/verifications/${v.id}/revoke`),
                            'Verification revoked',
                          ),
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
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
