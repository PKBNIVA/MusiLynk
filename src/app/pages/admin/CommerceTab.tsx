import { useEffect, useState } from 'react';
import { RefreshCw, CreditCard, Undo2 } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../../lib/api';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type {
  AdminBooking,
  AdminRefund,
  AdminSubscription,
  BillingAttempt,
  BillingEventSummary,
} from '../../lib/apiTypes';
import { errorMessage } from '../../lib/errors';
import { Panel, Pager, Empty, date, RECONCILABLE, type AdminActions, type PageMeta } from './shared';
import { AdminPageHeader, HowToCallout, InfoTip } from './ui';
import { formatMoney } from '../../lib/format';

const money = (currency: string | null | undefined, value: unknown) =>
  formatMoney(Number(value || 0), currency || 'INR');

// Self-fetches from GET/PATCH /api/admin/refunds (Admin::RefundsController) — a separate data
// source from the rest of this tab (which is fed by AdminDashboard), so this list never needs a
// change there. Never moves money itself: "Mark done" only records that an admin processed the
// refund manually in the Razorpay dashboard (see backend/app/models/refund_record.rb).
function RefundsToReview() {
  const [refunds, setRefunds] = useState<AdminRefund[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    apiGet<{ refunds: AdminRefund[] }>('/admin/refunds?status=pending_manual')
      .then((d) => {
        setRefunds(d.refunds);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Unable to load refunds.')));
  };
  useEffect(load, []);

  async function markDone(id: string) {
    setBusy(id);
    try {
      await apiPatch(`/admin/refunds/${id}`, { note: 'Refunded manually in the Razorpay dashboard' });
      toast.success('Refund marked done');
      load();
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to mark this refund done.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
      <CardHeader>
        <CardTitle>
          <h2>Refunds to review</h2>
        </CardTitle>
        <p className="text-sm text-slate-400">
          Cancellations and no-shows that owe a refund. None of these move money on their own — process the refund in
          the Razorpay dashboard, then mark it done here.
        </p>
      </CardHeader>
      <CardContent
        className="space-y-3 max-h-[520px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
        tabIndex={0}
        role="region"
        aria-label="Refunds to review"
      >
        <Panel error={error} onRetry={load} loading={refunds === null}>
          {(refunds || []).map((r) => (
            <div
              key={r.id}
              className="border-b border-white/10 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{r.actName || 'Booking'}</b>
                  <Badge className="bg-amber-500/15 text-amber-200">{r.reason.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {r.requesterName} · {money(r.currency, r.amount)} ({r.refundPercent}%) · requested by {r.requestedBy}{' '}
                  · {date(r.createdAt, true)}
                </div>
                {r.note && <div className="text-xs text-slate-500 mt-1">{r.note}</div>}
              </div>
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => markDone(r.id)}>
                <Undo2 aria-hidden="true" size={14} className="mr-1" />
                {busy === r.id ? 'Marking done…' : 'Mark done'}
              </Button>
            </div>
          ))}
          {!(refunds || []).length && <Empty text="No refunds waiting on review." />}
        </Panel>
      </CardContent>
    </Card>
  );
}

export default function CommerceTab({
  attempts,
  billingEvents,
  subscriptions,
  bookings,
  errors,
  loading,
  retry,
  actions,
  metas,
  onPage,
  earlyAccess,
}: {
  attempts: BillingAttempt[];
  billingEvents: BillingEventSummary[];
  subscriptions: AdminSubscription[];
  bookings: AdminBooking[];
  errors: { attempts?: string; billingEvents?: string; subscriptions?: string; bookings?: string };
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
  metas: { attempts?: PageMeta; billingEvents?: PageMeta; subscriptions?: PageMeta; bookings?: PageMeta };
  onPage: (source: 'attempts' | 'billingEvents' | 'subscriptions' | 'bookings', page: number) => void;
  earlyAccess?: { granted: number; seats: number };
}) {
  const { busy, act } = actions;
  return (
    <div>
      <AdminPageHeader
        icon={CreditCard}
        title="Commerce"
        description={
          earlyAccess
            ? `Billing attempts, webhook events, subscriptions and bookings. Early Access Pro: ${earlyAccess.granted} of ${earlyAccess.seats} granted.`
            : 'Billing attempts, webhook events, subscriptions and bookings — mostly read-only, one repair action.'
        }
      />
      <HowToCallout storageKey="commerce">
        Only <b>Billing attempts</b> can be acted on.{' '}
        <InfoTip
          label="Reconcile"
          text="Asks the payment provider for that attempt's real, current state and attaches it here — use it when an attempt looks stuck."
        />{' '}
        <b>Reconcile</b> is available once an attempt is pending, ambiguous or failed and has a provider id to look up.
      </HowToCallout>
      <div className="grid xl:grid-cols-2 gap-5">
        <RefundsToReview />
        <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Billing attempts</h2>
            </CardTitle>
            <p className="text-sm text-slate-400">
              Provider calls that did not finish cleanly. Reconcile asks Razorpay for the real state and attaches it.
            </p>
          </CardHeader>
          <CardContent
            className="space-y-3 max-h-[520px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            tabIndex={0}
            role="region"
            aria-label="Billing attempts"
          >
            <Panel error={errors.attempts} onRetry={retry} loading={loading}>
              {attempts.map((a) => {
                const canReconcile = RECONCILABLE.has(a.state) && !!a.provider_resource_id;
                return (
                  <div
                    key={a.id}
                    className="border-b border-white/10 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{a.operation}</b>
                        <Badge
                          className={
                            a.state === 'succeeded'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : a.state === 'failed'
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-amber-500/15 text-amber-200'
                          }
                        >
                          {a.state}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 break-all">
                        {a.email} · {a.provider} · {a.provider_resource_id || 'no provider id'} ·{' '}
                        {date(a.created_at, true)}
                      </div>
                      {a.error_message && (
                        <div className="text-xs text-rose-300 mt-1">
                          {a.error_code ? `${a.error_code}: ` : ''}
                          {a.error_message}
                        </div>
                      )}
                    </div>
                    {RECONCILABLE.has(a.state) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy || !canReconcile}
                        title={
                          canReconcile ? undefined : 'No provider id was recorded, so there is nothing to look up.'
                        }
                        onClick={() =>
                          act(
                            `bill:${a.id}`,
                            () => apiPost(`/admin/billing-attempts/${a.id}/reconcile`),
                            'Billing attempt reconciled',
                          ).catch(() => {})
                        }
                      >
                        <RefreshCw aria-hidden="true" size={14} className="mr-1" />
                        {busy === `bill:${a.id}` ? 'Reconciling…' : 'Reconcile'}
                      </Button>
                    )}
                  </div>
                );
              })}
              {!attempts.length && <Empty text="No billing attempts recorded." />}
              <Pager meta={metas.attempts} onPage={(p) => onPage('attempts', p)} loading={loading} />
            </Panel>
          </CardContent>
        </Card>
        <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Billing events</h2>
            </CardTitle>
            <p className="text-sm text-slate-400">
              Razorpay webhooks as they were processed (read-only, newest first).
            </p>
          </CardHeader>
          <CardContent
            className="space-y-3 max-h-[520px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            tabIndex={0}
            role="region"
            aria-label="Billing events"
          >
            <Panel error={errors.billingEvents} onRetry={retry} loading={loading}>
              {billingEvents.map((e) => (
                <div
                  key={e.id}
                  className="border-b border-white/10 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="break-all">{e.eventType}</b>
                      <Badge
                        className={
                          /fail|error|reject/i.test(e.processingResult || '')
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-white/10 text-slate-200'
                        }
                      >
                        {e.processingResult || 'received'}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 mt-1 break-all">
                      {[e.email, e.subscriptionId, e.paymentId, e.orderId].filter(Boolean).join(' · ') ||
                        e.providerEventId}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 shrink-0">
                    {e.amount != null ? `${formatMoney(Number(e.amount) / 100, e.currency || 'INR')} · ` : ''}
                    {date(e.processedAt || e.createdAt, true)}
                  </div>
                </div>
              ))}
              {!billingEvents.length && <Empty text="No billing events received." />}
              <Pager meta={metas.billingEvents} onPage={(p) => onPage('billingEvents', p)} loading={loading} />
            </Panel>
          </CardContent>
        </Card>
        <Card className="bg-white/[.05] border-white/10">
          <CardHeader>
            <CardTitle>
              <h2>Subscriptions</h2>
            </CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3 max-h-[650px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            tabIndex={0}
            role="region"
            aria-label="Subscriptions"
          >
            <Panel error={errors.subscriptions} onRetry={retry} loading={loading}>
              {subscriptions.map((s) => (
                <div key={s.id} className="border-b border-white/10 pb-3">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <b>{s.name}</b>
                      <div className="text-xs text-slate-400 break-all">{s.email}</div>
                    </div>
                    <Badge>
                      {s.plan_code} · {s.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    {s.provider} · created {date(s.created_at)}
                    {s.current_period_end ? ` · until ${date(s.current_period_end)}` : ''}
                  </div>
                </div>
              ))}
              {!subscriptions.length && <Empty text="No paid subscription history." />}
              <Pager meta={metas.subscriptions} onPage={(p) => onPage('subscriptions', p)} loading={loading} />
            </Panel>
          </CardContent>
        </Card>
        <Card className="bg-white/[.05] border-white/10">
          <CardHeader>
            <CardTitle>
              <h2>Booking operations</h2>
            </CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3 max-h-[650px] overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            tabIndex={0}
            role="region"
            aria-label="Booking operations"
          >
            <Panel error={errors.bookings} onRetry={retry} loading={loading}>
              {bookings.map((b) => (
                <div key={b.id} className="border-b border-white/10 pb-3">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <b>{b.actName}</b>
                      <div className="text-xs text-slate-400">
                        {b.requesterName} → {b.actOwner}
                      </div>
                    </div>
                    <Badge>{b.status}</Badge>
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    {[b.event_type, b.event_date, b.city].filter(Boolean).join(' · ')}
                    {Number(b.paidAmount) > 0
                      ? ` · paid ${formatMoney(Number(b.paidAmount), b.currency || 'INR')}`
                      : ''}
                  </div>
                </div>
              ))}
              {!bookings.length && <Empty text="No bookings yet." />}
              <Pager meta={metas.bookings} onPage={(p) => onPage('bookings', p)} loading={loading} />
            </Panel>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
