import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquareWarning } from 'lucide-react';
import { apiGet, apiPatch } from '../../lib/api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import type { AdminProblemReport, ProblemReportStatus } from '../../lib/apiTypes';
import { errorMessage } from '../../lib/errors';
import { Empty, Pager, Panel, date, type PageMeta } from './shared';
import { AdminPageHeader, AdminSelect, HowToCallout } from './ui';

// GET /api/admin/problem-reports (Admin::ProblemReportsController): what people sent through the
// in-app "Report a problem" dialog. Self-contained like UrgentTab: it loads its own data. The
// screenshot is never in the list; it is fetched on request as a short-lived signed link.

const STATUS_LABEL: Record<ProblemReportStatus, string> = { new: 'New', triaged: 'Triaged', resolved: 'Resolved' };
const STATUS_TONE: Record<ProblemReportStatus, string> = {
  new: 'bg-sky-500/15 text-sky-200',
  triaged: 'bg-amber-500/15 text-amber-200',
  resolved: 'bg-emerald-500/15 text-emerald-200',
};
type Counts = Record<ProblemReportStatus, number>;
type ListResponse = { reports: AdminProblemReport[]; counts: Counts; page: number; perPage: number; total: number };

const who = (r: AdminProblemReport) =>
  r.user ? `${r.user.name} (${r.user.email})` : r.email ? `${r.email} (signed out)` : 'Unknown sender';

export default function ProblemReportsTab() {
  const [status, setStatus] = useState<'' | ProblemReportStatus>('new');
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<AdminProblemReport[]>([]);
  const [counts, setCounts] = useState<Counts>({ new: 0, triaged: 0, resolved: 0 });
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('report'));
  const [openReport, setOpenReport] = useState<AdminProblemReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), perPage: '50' });
      if (status) qs.set('status', status);
      const d = await apiGet<ListResponse>(`/admin/problem-reports?${qs.toString()}`);
      setReports(d.reports || []);
      setCounts(d.counts || { new: 0, triaged: 0, resolved: 0 });
      setMeta({ page: d.page, perPage: d.perPage, total: d.total });
      setError('');
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not load problem reports.'));
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // The founder email links to ?tab=problems&report=<id>: open that report straight away.
  useEffect(() => {
    if (!openId) {
      setOpenReport(null);
      return;
    }
    let cancelled = false;
    apiGet<{ report: AdminProblemReport }>(`/admin/problem-reports/${encodeURIComponent(openId)}`)
      .then((d) => !cancelled && setOpenReport(d.report))
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(errorMessage(e, 'Could not open this report.'));
        setOpenId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const statusOptions = [
    { value: '', label: `All statuses (${counts.new + counts.triaged + counts.resolved})` },
    { value: 'new', label: `New (${counts.new})` },
    { value: 'triaged', label: `Triaged (${counts.triaged})` },
    { value: 'resolved', label: `Resolved (${counts.resolved})` },
  ];

  return (
    <div>
      <AdminPageHeader
        icon={MessageSquareWarning}
        title="Problem reports"
        description="What people told us went wrong from inside the app, with the page they were on and a screenshot when they added one."
      />
      <HowToCallout storageKey="problem-reports">
        Open a report to read it, see the screenshot and change its status. <b>New</b> means nobody has looked yet; mark
        it <b>Triaged</b> once you have, and <b>Resolved</b> when it is fixed. Signed-out reports include an email you
        can reply to.
      </HowToCallout>
      <div className="mb-4">
        <Label htmlFor="problem-report-status">Status</Label>
        <div className="mt-1">
          <AdminSelect
            id="problem-report-status"
            value={status}
            onChange={(v) => {
              setStatus(v as typeof status);
              setPage(1);
            }}
            options={statusOptions}
          />
        </div>
      </div>
      <Panel error={error} onRetry={load} loading={loading}>
        {loading && reports.length === 0 ? (
          <p className="text-slate-400 text-center py-10" role="status">
            Loading…
          </p>
        ) : reports.length === 0 ? (
          <Empty icon={MessageSquareWarning} text="No problem reports match this filter." hint="Try another status." />
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <Card key={r.id} className="bg-white/[.05] border-white/10">
                <CardContent className="p-4 flex flex-col sm:flex-row justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.hasScreenshot && <Badge variant="secondary">Screenshot</Badge>}
                      <span className="text-xs text-slate-400">{date(r.createdAt, true)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-100 line-clamp-3 break-words [overflow-wrap:anywhere]">
                      {r.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 break-all">
                      {who(r)}
                      {r.page ? ` · ${r.page}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Button size="sm" onClick={() => setOpenId(r.id)} aria-label={`Open problem report from ${who(r)}`}>
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Pager meta={meta} onPage={setPage} loading={loading} />
      </Panel>
      <ReportDetail
        report={openReport}
        onClose={() => {
          setOpenId(null);
          setOpenReport(null);
        }}
        onChanged={(next) => {
          setOpenReport(next);
          void load();
        }}
      />
    </div>
  );
}

function ReportDetail({
  report,
  onClose,
  onChanged,
}: {
  report: AdminProblemReport | null;
  onClose: () => void;
  onChanged: (next: AdminProblemReport) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<{ url: string; expiresAt: string } | null>(null);
  const [shotError, setShotError] = useState('');

  useEffect(() => {
    setNote(report?.adminNote ?? '');
    setShot(null);
    setShotError('');
  }, [report?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(body: { status?: ProblemReportStatus; adminNote?: string }, done: string) {
    if (!report) return;
    setBusy(true);
    try {
      const d = await apiPatch<{ report: AdminProblemReport }>(`/admin/problem-reports/${report.id}`, body);
      toast.success(done);
      onChanged(d.report);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not update this report.'));
    } finally {
      setBusy(false);
    }
  }

  async function showScreenshot() {
    if (!report) return;
    setShotError('');
    try {
      setShot(await apiGet<{ url: string; expiresAt: string }>(`/admin/problem-reports/${report.id}/screenshot`));
    } catch (e: unknown) {
      setShotError(errorMessage(e, 'Could not load the screenshot.'));
    }
  }

  const ctx = report?.context ?? {};
  const rows: [string, string][] = report
    ? (
        [
          ['From', who(report)],
          ['Sent', date(report.createdAt, true)],
          ['Page', report.page || 'Not shared'],
          ['App version', ctx.release || ''],
          ['Browser and device', [ctx.browser, ctx.os].filter(Boolean).join(', ')],
          ['Screen size', ctx.viewport ? `${ctx.viewport.width} × ${ctx.viewport.height}` : ''],
          ['Account type', ctx.role || ''],
          [
            'Last handled',
            report.handledAt ? `${date(report.handledAt, true)} by ${report.handledByName || 'an admin'}` : '',
          ],
        ] as [string, string][]
      ).filter(([, value]) => value)
    : [];

  return (
    <Dialog open={Boolean(report)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-950 text-white border-white/15 max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {report && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">Problem report</DialogTitle>
              <DialogDescription className="text-slate-400">
                <Badge className={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Badge>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <section aria-label="What happened">
                <h3 className="text-sm font-semibold text-slate-300">What happened</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                  {report.description}
                </p>
              </section>
              {report.expected && (
                <section aria-label="What they expected">
                  <h3 className="text-sm font-semibold text-slate-300">What they expected</h3>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
                    {report.expected}
                  </p>
                </section>
              )}
              <dl className="grid gap-1 text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[9rem_1fr] gap-2">
                    <dt className="text-slate-400">{label}</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
              {ctx.errors && ctx.errors.length > 0 && (
                <section aria-label="Recent errors">
                  <h3 className="text-sm font-semibold text-slate-300">Recent errors in their browser</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-300">
                    {ctx.errors.map((message, index) => (
                      <li key={index} className="break-words">
                        {message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {report.hasScreenshot && (
                <section aria-label="Screenshot">
                  <h3 className="text-sm font-semibold text-slate-300">Screenshot</h3>
                  {shot ? (
                    <div className="mt-2">
                      <img
                        src={shot.url}
                        alt="Screenshot attached to this report"
                        className="max-h-96 w-full rounded-lg border border-white/10 object-contain bg-black/30"
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        This link expires in a few minutes. Open the report again for a fresh one.
                      </p>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => void showScreenshot()}
                    >
                      Show screenshot
                    </Button>
                  )}
                  {shotError && (
                    <p role="alert" className="mt-1 text-sm text-rose-300">
                      {shotError}
                    </p>
                  )}
                </section>
              )}
              <div>
                <Label htmlFor="problem-report-note">Your note (only admins see this)</Label>
                <Textarea
                  id="problem-report-note"
                  className="mt-1"
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy || note === (report.adminNote ?? '')}
                  onClick={() => void save({ adminNote: note }, 'Note saved')}
                >
                  Save note
                </Button>
              </div>
            </div>
            <DialogFooter className="gap-2 flex-wrap sm:justify-between">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Change status">
                {(['new', 'triaged', 'resolved'] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={report.status === s ? 'default' : 'outline'}
                    aria-pressed={report.status === s}
                    disabled={busy || report.status === s}
                    onClick={() => void save({ status: s }, `Marked ${STATUS_LABEL[s].toLowerCase()}`)}
                  >
                    {s === 'new' ? 'Mark new' : `Mark ${s}`}
                  </Button>
                ))}
              </div>
              <Button type="button" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
