import { RefreshCw } from 'lucide-react';
import { apiPost } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import type { AdminBooking, AdminSubscription, BillingAttempt, BillingEventSummary } from '../../lib/apiTypes';
import { Panel, Empty, date, RECONCILABLE, type AdminActions } from './shared';

export default function CommerceTab({
  attempts,
  billingEvents,
  subscriptions,
  bookings,
  errors,
  loading,
  retry,
  actions,
}: {
  attempts: BillingAttempt[];
  billingEvents: BillingEventSummary[];
  subscriptions: AdminSubscription[];
  bookings: AdminBooking[];
  errors: { attempts?: string; billingEvents?: string; subscriptions?: string; bookings?: string };
  loading: boolean;
  retry: () => void;
  actions: AdminActions;
}) {
  const { busy, act } = actions;
  return (
    <div className="grid xl:grid-cols-2 gap-5">
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
                      title={canReconcile ? undefined : 'No provider id was recorded, so there is nothing to look up.'}
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
          </Panel>
        </CardContent>
      </Card>
      <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
        <CardHeader>
          <CardTitle>
            <h2>Billing events</h2>
          </CardTitle>
          <p className="text-sm text-slate-400">Razorpay webhooks as they were processed (read-only, newest first).</p>
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
                  {e.amount != null
                    ? `${(e.currency || 'INR').toUpperCase()} ${(Number(e.amount) / 100).toLocaleString()} · `
                    : ''}
                  {date(e.processedAt || e.createdAt, true)}
                </div>
              </div>
            ))}
            {!billingEvents.length && <Empty text="No billing events received." />}
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
                    ? ` · paid ${b.currency || 'INR'} ${Number(b.paidAmount).toLocaleString()}`
                    : ''}
                </div>
              </div>
            ))}
            {!bookings.length && <Empty text="No bookings yet." />}
          </Panel>
        </CardContent>
      </Card>
    </div>
  );
}
