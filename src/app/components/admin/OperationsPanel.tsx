import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { errorMessage } from '../../lib/errors';
import { formatNumber, formatDateTime } from '../../lib/format';

type Window = {
  requests: number;
  serverErrors: number;
  serverErrorRate: number | null;
  p95Ms: number | null;
  p95OverMs: number | null;
};
type PaymentCounts = { failed24h: number; pending24h: number };
export type Operations = {
  generatedAt: string;
  requests: { lastHour: Window; last24Hours: Window; collectingSince: string | null };
  jobs: {
    queued: number;
    running: number;
    scheduled: number;
    oldestQueuedAt: string | null;
    oldestQueuedAgeSeconds: number | null;
    failed24h: number;
    failedByClass24h: Record<string, number>;
    erroredRuns24h: number;
  };
  payments: { bookingPayments: PaymentCounts; billingAttempts: PaymentCounts };
  email: {
    deliveryFailures24h: number;
    retriedSends24h: number;
    addressesReported24h: Record<string, number>;
    suppressedAddresses: number;
    webhookConfigured: boolean;
  };
  /** Required fields of config/legal.yml that still hold a "[PLACEHOLDER]" (e.g. "grievance_officer.email"). */
  legal?: { unfilled: string[]; invoiceSellerPending?: string[] };
};

const REFRESH_MS = 60_000;
// Thresholds that turn a figure amber. They are prompts to look, not alerts.
const ERROR_RATE_WARN = 0.01;
const P95_WARN_MS = 1_000;
const QUEUE_AGE_WARN_S = 10 * 60;

export function formatP95(w: Window) {
  if (w.p95OverMs) return `> ${w.p95OverMs / 1000} s`;
  if (w.p95Ms === null) return '—';
  return w.p95Ms >= 1000 ? `≤ ${w.p95Ms / 1000} s` : `≤ ${w.p95Ms} ms`;
}

export function formatRate(rate: number | null) {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.001 ? 2 : 1)}%`;
}

export function formatAge(seconds: number | null) {
  if (seconds === null) return 'None waiting';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function Figure({
  label,
  value,
  warn = false,
  testId,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-warn={warn || undefined}
      className={`rounded-xl border p-3 ${warn ? 'border-amber-400/40 bg-amber-500/10' : 'border-white/10 bg-white/[.03]'}`}
    >
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? 'text-amber-200' : ''}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="bg-white/[.05] border-white/10">
      <CardHeader>
        <h2 className="leading-none">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function Breakdown({ label, counts, empty }: { label: string; counts: Record<string, number>; empty: string }) {
  const entries = Object.entries(counts);
  return (
    <div className="text-sm">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      {entries.length === 0 ? (
        <div className="text-slate-500">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {entries.map(([name, n]) => (
            <li key={name} className="flex justify-between gap-3">
              <span className="break-all">{name.replace(/_/g, ' ')}</span>
              <b>{n}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Traffic({ label, w, id }: { label: string; w: Window; id: string }) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        <Figure testId={`${id}-requests`} label="Requests" value={formatNumber(w.requests)} />
        <Figure
          testId={`${id}-p95`}
          label="p95 latency"
          value={formatP95(w)}
          warn={!!w.p95OverMs || (w.p95Ms ?? 0) > P95_WARN_MS}
        />
        <Figure
          testId={`${id}-errors`}
          label="5xx rate"
          value={formatRate(w.serverErrorRate)}
          warn={(w.serverErrorRate ?? 0) >= ERROR_RATE_WARN}
        />
      </div>
    </div>
  );
}

export default function OperationsPanel() {
  const [data, setData] = useState<Operations>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<Operations>('/admin/operations'));
      setError('');
    } catch (e: unknown) {
      setError(errorMessage(e, 'Unable to load operations data.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div data-testid="operations-panel" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          {data ? `Updated ${formatDateTime(data.generatedAt)}. Refreshes every minute.` : 'Loading…'}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw aria-hidden="true" size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <AlertTriangle aria-hidden="true" size={16} />
          {error}
        </div>
      )}
      {data?.legal && data.legal.unfilled.length > 0 && (
        <div
          role="alert"
          data-testid="legal-unfilled"
          className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100"
        >
          <strong className="font-semibold">Legal details unfilled</strong>
          <span className="text-red-200"> — the Terms, Privacy and invoices still lack: </span>
          <span className="font-mono text-xs">{data.legal.unfilled.join(', ')}</span>
        </div>
      )}
      {data?.legal?.invoiceSellerPending && data.legal.invoiceSellerPending.length > 0 && (
        <div
          role="alert"
          data-testid="invoice-seller-pending"
          className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <strong className="font-semibold">Invoice seller details pending</strong>
          <span className="text-amber-200">
            {' '}
            — subscription invoices are held back in production until these are filled in:{' '}
          </span>
          <span className="font-mono text-xs">{data.legal.invoiceSellerPending.join(', ')}</span>
        </div>
      )}
      {data && (
        <div className="grid xl:grid-cols-2 gap-5">
          <Section title="API traffic">
            <Traffic id="hour" label="Last hour" w={data.requests.lastHour} />
            <Traffic id="day" label="Last 24 hours" w={data.requests.last24Hours} />
            <p className="text-xs text-slate-500">
              {data.requests.collectingSince
                ? `Collected since ${formatDateTime(data.requests.collectingSince)}. `
                : 'No requests recorded yet. '}
              Health probes are excluded; p95 is the upper edge of its latency bucket.
            </p>
          </Section>

          <Section title="Background jobs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Figure testId="jobs-queued" label="Queued" value={data.jobs.queued} />
              <Figure
                testId="jobs-oldest"
                label="Oldest queued"
                value={formatAge(data.jobs.oldestQueuedAgeSeconds)}
                warn={(data.jobs.oldestQueuedAgeSeconds ?? 0) >= QUEUE_AGE_WARN_S}
              />
              <Figure label="Running" value={data.jobs.running} />
              <Figure label="Scheduled or retrying" value={data.jobs.scheduled} />
              <Figure
                testId="jobs-failed"
                label="Failed (24 h)"
                value={data.jobs.failed24h}
                warn={data.jobs.failed24h > 0}
              />
              <Figure label="Errored runs (24 h)" value={data.jobs.erroredRuns24h} />
            </div>
            <Breakdown
              label="Failed jobs by class (24 h)"
              counts={data.jobs.failedByClass24h}
              empty="No failed jobs."
            />
          </Section>

          <Section title="Payments (24 h)">
            <div className="grid grid-cols-2 gap-2">
              <Figure
                testId="deposits-failed"
                label="Booking deposits failed"
                value={data.payments.bookingPayments.failed24h}
                warn={data.payments.bookingPayments.failed24h > 0}
              />
              <Figure label="Booking deposits pending" value={data.payments.bookingPayments.pending24h} />
              <Figure
                label="Billing attempts failed"
                value={data.payments.billingAttempts.failed24h}
                warn={data.payments.billingAttempts.failed24h > 0}
              />
              <Figure label="Billing attempts unresolved" value={data.payments.billingAttempts.pending24h} />
            </div>
          </Section>

          <Section title="Email (24 h)">
            <div className="grid grid-cols-3 gap-2">
              <Figure
                testId="email-failures"
                label="Delivery failures"
                value={data.email.deliveryFailures24h}
                warn={data.email.deliveryFailures24h > 0}
              />
              <Figure label="Sends retried" value={data.email.retriedSends24h} />
              <Figure label="Suppressed addresses" value={data.email.suppressedAddresses} />
            </div>
            <Breakdown
              label="Addresses reported by the provider (24 h)"
              counts={data.email.addressesReported24h}
              empty="No bounces, complaints or unsubscribes."
            />
            {!data.email.webhookConfigured && (
              <p className="text-xs text-amber-200">
                The bounce webhook is not configured (BREVO_WEBHOOK_SECRET), so bounces are not being recorded.
              </p>
            )}
          </Section>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Nightly database backups run in GitHub Actions (the “Database backup” workflow); a failed run opens an issue
        there.
      </p>
    </div>
  );
}
