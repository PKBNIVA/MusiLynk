import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { openRazorpayCheckout } from '../lib/razorpayCheckout';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { AlertTriangle, Check, ClipboardCheck, CreditCard, FlaskConical, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import type {
  BillingCancellation,
  BillingCheckout,
  BillingHistoryEntry,
  BillingInterval,
  BillingPlans,
  BillingPromo,
  Plan,
  ReferralCode,
  Subscription,
} from '../lib/apiTypes';
import { IntervalToggle } from '../components/IntervalToggle';
import {
  annualLine,
  describePromo,
  inr,
  normaliseCode,
  periodPrice,
  storeCode,
  storedCode,
  referralShareText,
} from '../lib/promo';
import { loadAiUsage, type AiUsage } from '../lib/ai';
import { formatDate, formatMoney } from '../lib/format';
import { optionLabel } from '../components/ui/option-labels';
import { ShareMenu } from '../components/ShareMenu';
import { PaymentsNotify } from '../components/PaymentsNotify';
import { BillingDetailsCard } from '../components/billing/BillingDetailsCard';
import { CheckoutBusinessDetails } from '../components/billing/CheckoutBusinessDetails';
import { InvoiceList } from '../components/billing/InvoiceList';
import { useBillingProfile } from '../lib/billingProfile';
import {
  draftFrom,
  emptyDraft,
  hasBusinessInput,
  type BillingProfileDraft,
  type BillingProfileErrors,
} from '../lib/billingProfile';

type Summary = {
  status: 'pending' | 'trialing' | 'active' | 'cancelling' | 'past_due' | 'cancelled' | 'early_access';
  planCode: string;
  planName: string;
  provider: string;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  nextChargeAt?: string | null;
  accessEndsAt?: string | null;
  monthlyAmount?: number | null;
  interval?: BillingInterval;
  amount?: number | null;
  nextAmount?: number | null;
  promo?: BillingPromo | null;
  earlyAccess?: { until: string | null } | null;
};
type BillingState = {
  subscription: Subscription | null;
  plan: Plan | null;
  purchasedPlan: Plan | null;
  summary: Summary | null;
  history: BillingHistoryEntry[];
  testMode: boolean;
  paymentMode?: PaymentMode;
};
type PaymentMode = 'live' | 'test' | 'mock' | 'disabled';

// Banner copy per payment mode; live payments need no banner.
const PAYMENT_MODE_NOTICE: Partial<Record<PaymentMode, [string, string]>> = {
  test: ['Test mode.', 'Payments here use test cards. No real money moves and no real cards are charged.'],
  mock: ['Trial only.', 'Paid plans start without a payment step for now, so nothing is charged.'],
  disabled: [
    'Payments open soon.',
    'Turn on the email option below and we’ll tell you when they do. Your current plan is not affected. Early Access Pro, which needs no card, is going to our first hirers.',
  ],
};

const day = (value?: string | null) => formatDate(value);
const money = (currency: string, value: number) => formatMoney(value, currency);

const STATUS_LABEL: Record<Summary['status'], string> = {
  pending: 'Setup incomplete',
  trialing: 'Free trial',
  active: 'Active',
  cancelling: 'Cancellation scheduled',
  past_due: 'Payment failed',
  cancelled: 'Cancelled',
  early_access: 'Early Access Pro',
};

function statusCopy(s: Summary): string {
  const price = s.nextAmount ?? s.amount ?? s.monthlyAmount;
  const amount = price ? `${inr(price)}${s.interval === 'annual' ? ' for the year' : ''}` : 'the plan price';
  switch (s.status) {
    case 'pending':
      return 'Checkout was not completed. Finish authorising the recurring payment to start your plan. Nothing has been charged.';
    case 'trialing':
      return `Your free trial ends on ${day(s.trialEndsAt)}. The first charge of ${amount} happens then unless you cancel before.`;
    case 'active':
      return s.nextChargeAt ? `Next charge: ${amount} on ${day(s.nextChargeAt)}.` : 'Your plan is active.';
    case 'cancelling':
      return `You will not be charged again. ${s.planName} features stay available until ${day(s.accessEndsAt)}, then your account moves to Free.`;
    case 'past_due':
      return 'We could not collect your latest payment, so paid features are paused. Razorpay retries automatically; use the payment link Razorpay emailed you to update your card, or cancel below.';
    case 'cancelled':
      return `Your ${s.planName} plan has ended. You are on the Free plan and can subscribe again at any time.`;
    case 'early_access':
      return `Pro — Early Access until ${day(s.earlyAccess?.until || s.accessEndsAt)}. No card needed. We'll email you 7 days and 1 day before it ends.`;
  }
}

function newIdempotencyKey() {
  const c: Partial<Crypto> | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// "Your referral code": the code is issued the first time this card loads. Hidden when the
// programme is off or the API is unreachable, since billing works without it.
function ReferralCard() {
  const [referral, setReferral] = useState<ReferralCode | null>(null);
  useEffect(() => {
    let active = true;
    apiGet<ReferralCode>('/me/referral-code')
      .then((r) => {
        if (active && r && typeof r.code === 'string') setReferral(r);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!referral) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referral.code);
      toast.success('Referral code copied');
    } catch {
      toast.error(`Copy failed. Your code is ${referral.code}.`);
    }
  };
  return (
    <Card className="mt-8 bg-violet-500/[.06] border-violet-400/20" data-testid="referral-card">
      <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Your referral code</h2>
          <p className="text-sm text-slate-300 mt-1">
            Friends who hire on MusiLynk get {referral.refereePercentOff ?? 20}% off with your code, and you earn free
            days when they pay.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code
              className="rounded-md bg-white/10 px-3 py-1.5 text-lg font-mono tracking-wider"
              data-testid="referral-code"
            >
              {referral.code}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <ClipboardCheck size={14} aria-hidden="true" className="mr-1.5" />
              Copy
            </Button>
            <ShareMenu
              surface="referral"
              path={referral.shareUrl}
              plainUrl
              channels={['whatsapp']}
              compose={(url) => referralShareText(referral.code, url, referral.refereePercentOff ?? 20)}
              testId="share-referral"
            />
          </div>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-slate-400">Redemptions</dt>
            <dd className="text-2xl font-semibold" data-testid="referral-redemptions">
              {referral.redemptions}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Rewards earned</dt>
            <dd className="text-2xl font-semibold" data-testid="referral-rewards">
              {referral.rewardsEarned}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export default function Billing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<BillingState | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [annualAvailable, setAnnualAvailable] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>(
    searchParams.get('interval') === 'annual' ? 'annual' : 'monthly',
  );
  // A code carried from the pricing page (?code=) or kept across sign-in; sent with checkout.
  const [promoCode] = useState(() => normaliseCode(searchParams.get('code') || '') || storedCode());
  const shownInterval: BillingInterval = annualAvailable ? interval : 'monthly';
  // One Idempotency-Key per checkout intent. It is kept after a network/gateway failure so a retry replays the same intent instead of creating a second subscription.
  const intentKeys = useRef<Record<string, string>>({});
  const inFlight = useRef(false);
  // "Buying for a business?": folded away until asked for; saved with the account just before checkout starts.
  const profileApi = useBillingProfile();
  const [businessOpen, setBusinessOpen] = useState(false);
  const [businessDraft, setBusinessDraft] = useState<BillingProfileDraft>(() => emptyDraft(undefined, 'business'));
  const [businessErrors, setBusinessErrors] = useState<BillingProfileErrors>({});
  const savedProfile = profileApi.data?.profile ?? null;
  const toggleBusiness = () => {
    if (!businessOpen) {
      setBusinessDraft(
        savedProfile?.buyerType === 'business'
          ? draftFrom(savedProfile)
          : { ...emptyDraft(undefined, 'business'), billingEmail: profileApi.data?.defaults.billingEmail ?? '' },
      );
      setBusinessErrors({});
    }
    setBusinessOpen(!businessOpen);
  };
  // Saves the open business section; false (with the problems shown) means checkout must not start yet.
  async function commitBusinessDetails() {
    if (!businessOpen || !hasBusinessInput(businessDraft)) return true;
    const result = await profileApi.save({ ...businessDraft, buyerType: 'business' });
    if (result.ok) {
      setBusinessErrors({});
      return true;
    }
    setBusinessErrors(result.errors);
    toast.error(result.message);
    return false;
  }

  const load = () =>
    Promise.all([apiGet<Partial<BillingPlans>>('/billing/plans'), apiGet<BillingState>('/billing/subscription')]).then(
      ([p, s]) => {
        setPlans(p.plans || []);
        setAnnualAvailable(p.annualAvailable === true);
        setState(s);
        return s;
      },
    );
  useEffect(() => {
    load().catch((e: unknown) => toast.error(errorMessage(e)));
  }, []);
  // One-click cancel link from a lifecycle reminder email (?cancel=1&t=...): verify the token
  // server-side for the signed-in user, then open the existing cancel dialog, pre-focused — never
  // cancel automatically. An invalid/expired/foreign token is ignored silently.
  useEffect(() => {
    if (searchParams.get('cancel') !== '1') return;
    const token = searchParams.get('t');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('cancel');
        next.delete('t');
        return next;
      },
      { replace: true },
    );
    if (!token) return;
    apiGet(`/billing/cancel-link?t=${encodeURIComponent(token)}`)
      .then(() => setConfirmOpen(true))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once, off the initial query string only
  }, []);
  useEffect(() => {
    loadAiUsage()
      .then((u) => {
        // Guards against an unmocked/misbehaving endpoint answering with an incomplete body.
        if (u && typeof u.remaining === 'number' && typeof u.limit === 'number') setAiUsage(u);
      })
      .catch(() => undefined);
  }, []);

  // Activation arrives by signed webhook, usually within seconds of checkout.
  async function waitForActivation() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const next = await load();
      if (next.summary && next.summary.status !== 'pending') return true;
      await wait(1500);
    }
    return false;
  }

  async function choose(code: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingPlan(code);
    if (!(await commitBusinessDetails())) {
      inFlight.current = false;
      setPendingPlan(null);
      return;
    }
    const intent = `${code}:${shownInterval}:${promoCode}`;
    const key = intentKeys.current[intent] || (intentKeys.current[intent] = newIdempotencyKey());
    try {
      const d = await apiPost<BillingCheckout>(
        '/billing/checkout',
        { planCode: code, interval: shownInterval, ...(promoCode ? { code: promoCode } : {}) },
        { headers: { 'Idempotency-Key': key } },
      );
      delete intentKeys.current[intent];
      storeCode('');
      if (d.salesAssisted) {
        toast.info(d.message);
        return;
      }
      if (d.checkout?.mode === 'early_access') {
        toast.success('Early Access Pro is active. No card needed.');
        await load();
        return;
      }
      if (d.checkout?.mode === 'mock') {
        toast.success('Trial started. Nothing was charged.');
        await load();
        return;
      }
      if (d.checkout?.mode === 'razorpay') {
        const plan = plans.find((p) => p.code === code);
        const result = await openRazorpayCheckout(d.checkout, {
          description: `${plan?.name || code} plan subscription`,
          amountLabel:
            plan && periodPrice(plan, shownInterval)
              ? `${inr(periodPrice(plan, shownInterval)!)} / ${shownInterval === 'annual' ? 'year' : 'month'}${plan.trialDays ? ` after a ${plan.trialDays}-day trial` : ''}`
              : '',
        });
        if (result.status === 'success') {
          toast.success('Payment method authorised. Activating your plan…');
          const activated = await waitForActivation();
          if (!activated)
            toast.info(
              'Your bank is still confirming the payment setup. This page updates once it arrives; refresh in a minute.',
            );
        } else if (result.lastError) {
          toast.error(`Payment not completed: ${result.lastError}`);
          await load();
        } else {
          toast.info('Checkout closed. Nothing was charged. You can finish setup at any time.');
          await load();
        }
      }
    } catch (e: unknown) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status !== 0 && status !== 502) delete intentKeys.current[intent];
      // A 503 is billing being switched off, not something to retry: say so in plain words.
      toast.error(
        status === 503
          ? 'Payments open soon. Your current plan is not affected; turn on the email option on this page to hear when they do.'
          : errorMessage(e),
      );
    } finally {
      inFlight.current = false;
      setPendingPlan(null);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const d = await apiPost<BillingCancellation>('/billing/cancel', {});
      toast.success(
        d.outcome === 'scheduled'
          ? `Cancellation scheduled. Access continues until ${day(d.accessEndsAt) || 'the end of the billing period'}.`
          : 'Subscription cancelled. You will not be charged.',
      );
      setConfirmOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }

  const sub = state?.subscription;
  const summary = state?.summary || null;
  // Billing is switched off here (A-11): paid upgrades cannot start, so their buttons say why instead of failing.
  const paymentsOff = state?.paymentMode === 'disabled';
  const notice = state ? PAYMENT_MODE_NOTICE[state.paymentMode || (state.testMode ? 'test' : 'live')] : undefined;
  const currentCode = summary && !['cancelled'].includes(summary.status) ? summary.planCode : 'free';
  const cancellable = summary && ['pending', 'trialing', 'active', 'past_due', 'early_access'].includes(summary.status);
  const immediateCancel = summary && summary.status !== 'active';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 sm:px-5 pt-28 pb-16">
        <PageHeader
          title="Billing"
          actions={
            state && (
              <Badge className="w-fit" data-testid="plan-badge">
                {summary
                  ? `${summary.planName} · ${STATUS_LABEL[summary.status]}`
                  : `${state.plan?.name || 'Free'} plan`}
              </Badge>
            )
          }
        />

        {notice && (
          <div
            role="status"
            id="payments-notice"
            className="mt-6 flex gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100"
          >
            <FlaskConical className="shrink-0 text-amber-300" size={18} />
            <span>
              <b>{notice[0]}</b> {notice[1]}
              {paymentsOff && <PaymentsNotify />}
            </span>
          </div>
        )}

        {summary && (
          <Card
            className={`mt-6 border ${summary.status === 'past_due' ? 'bg-rose-500/[.07] border-rose-400/30' : summary.status === 'trialing' ? 'bg-emerald-500/[.06] border-emerald-400/20' : 'bg-white/[.05] border-white/10'}`}
            data-testid="billing-status"
          >
            <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex gap-3">
                {summary.status === 'past_due' ? (
                  <AlertTriangle className="text-rose-300 shrink-0" />
                ) : summary.status === 'trialing' ? (
                  <ShieldCheck className="text-emerald-300 shrink-0" />
                ) : (
                  <CreditCard className="text-violet-300 shrink-0" />
                )}
                <div>
                  <h2 className="font-semibold text-lg">
                    {summary.status === 'early_access' ? (
                      `${summary.planName} — Early Access until ${day(summary.earlyAccess?.until || summary.accessEndsAt)}`
                    ) : (
                      <>
                        {summary.planName} plan ·{' '}
                        <span data-testid="billing-status-label">{STATUS_LABEL[summary.status]}</span>
                      </>
                    )}
                  </h2>
                  <p className="text-sm text-slate-300 mt-1 max-w-3xl" data-testid="billing-status-copy">
                    {statusCopy(summary)}
                  </p>
                  {summary.promo && (
                    <p className="text-sm text-emerald-300 mt-2 flex items-center gap-1.5" data-testid="billing-promo">
                      <Sparkles size={14} aria-hidden="true" />
                      {describePromo(summary.promo)}
                    </p>
                  )}
                  {summary.nextChargeAt && (
                    <p className="text-xs text-slate-400 mt-2">
                      Next charge date: <span data-testid="next-charge-date">{day(summary.nextChargeAt)}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {summary.status === 'pending' && (
                  <Button
                    disabled={pendingPlan !== null || paymentsOff}
                    aria-describedby={paymentsOff ? 'payments-notice' : undefined}
                    onClick={() => choose(summary.planCode)}
                  >
                    Complete setup
                  </Button>
                )}
                {cancellable && (
                  <Button
                    variant="outline"
                    className="text-rose-300"
                    disabled={cancelling}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Cancel subscription
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {(annualAvailable || promoCode) && (
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {annualAvailable && <IntervalToggle value={interval} onChange={setInterval} />}
            {promoCode && (
              <span className="text-sm text-slate-300 flex items-center gap-1.5" data-testid="billing-code-note">
                <Sparkles size={14} aria-hidden="true" className="text-violet-300" />
                Code <b>{promoCode}</b> is applied at checkout
              </span>
            )}
          </div>
        )}

        {profileApi.data && plans.some((p) => p.code !== 'free') && (
          <CheckoutBusinessDetails
            open={businessOpen}
            onToggle={toggleBusiness}
            draft={businessDraft}
            errors={businessErrors}
            states={profileApi.data.states}
            savedName={savedProfile?.buyerType === 'business' && !businessOpen ? savedProfile.legalName : undefined}
            onChange={(key, value) => {
              setBusinessDraft({ ...businessDraft, [key]: value });
              if (businessErrors[key]) setBusinessErrors({ ...businessErrors, [key]: undefined });
            }}
          />
        )}

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mt-7">
          {plans.map((p) => (
            <Card
              key={p.code}
              className={`bg-white/[.055] border-white/10 ${currentCode === p.code ? 'ring-1 ring-violet-400' : ''}`}
              data-testid={`plan-${p.code}`}
            >
              <CardContent className="p-5">
                <h2 className="text-xl font-semibold">{p.name}</h2>
                <div className="text-3xl font-bold mt-3">
                  {p.monthly === null
                    ? 'Custom'
                    : p.monthly === 0
                      ? 'Free'
                      : inr(periodPrice(p, shownInterval) ?? p.monthly)}{' '}
                  {(p.monthly ?? 0) > 0 && (
                    <span className="text-xs font-normal text-slate-500">
                      {shownInterval === 'annual' && p.annual ? '/year' : '/month'}
                    </span>
                  )}
                </div>
                {shownInterval === 'annual' && !!p.annual && (
                  <div className="text-sm text-emerald-300 mt-1">{annualLine(p.annual)}</div>
                )}
                {p.trialDays > 0 && (
                  <div className="text-sm text-emerald-300 mt-1">
                    {p.trialDays}-day free trial for your first paid plan
                  </div>
                )}
                <div className="space-y-2 text-sm text-slate-300 mt-5">
                  {[
                    `Up to ${p.activePosts} active ${p.activePosts === 1 ? 'opportunity' : 'opportunities'}`,
                    `${p.seats} team seat${p.seats === 1 ? '' : 's'}`,
                    `Save up to ${p.shortlist} musicians to your shortlist`,
                    `${p.bookings} active booking ${p.bookings === 1 ? 'enquiry' : 'enquiries'}`,
                  ].map((x) => (
                    <div className="flex gap-2" key={x}>
                      <Check size={15} className="text-emerald-300 mt-0.5" />
                      {x}
                    </div>
                  ))}
                </div>
                {p.code !== 'free' && !(paymentsOff && p.code !== 'enterprise' && currentCode !== p.code) && (
                  <Button
                    className="w-full mt-6"
                    variant={currentCode === p.code ? 'secondary' : 'default'}
                    disabled={pendingPlan !== null || (currentCode === p.code && summary?.status !== 'pending')}
                    aria-busy={pendingPlan === p.code}
                    onClick={() => choose(p.code)}
                  >
                    {pendingPlan === p.code
                      ? 'Preparing checkout…'
                      : currentCode === p.code && summary?.status === 'pending'
                        ? 'Complete setup'
                        : currentCode === p.code
                          ? 'Current plan'
                          : p.code === 'enterprise'
                            ? 'Contact sales'
                            : sub
                              ? `Switch to ${p.name}`
                              : 'Start free trial'}
                  </Button>
                )}
                {paymentsOff && p.code !== 'free' && p.code !== 'enterprise' && currentCode !== p.code && (
                  <p className="mt-2 text-xs text-slate-400" data-testid={`plan-${p.code}-unavailable`}>
                    Available when payments open.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {aiUsage && (
          <p className="mt-8 flex items-center gap-1.5 text-sm text-slate-400" data-testid="ai-usage-hint">
            <Sparkles aria-hidden="true" size={14} className="text-violet-300" />
            AI help: {aiUsage.remaining} of {aiUsage.limit} left
            {aiUsage.period === 'month' ? ' this month.' : ', a one-time allowance for your account.'}
          </p>
        )}

        <ReferralCard />

        {(state?.history?.length || 0) > 0 && (
          <Card className="mt-8 bg-white/[.04] border-white/10">
            <CardContent className="p-5">
              <h2 className="font-semibold">Payment history</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm" data-testid="payment-history">
                  <thead className="text-left text-slate-400">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Amount</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state!.history.map((h) => (
                      <tr key={h.paymentId} className="border-t border-white/10">
                        <td className="py-2 pr-4">{day(h.at)}</td>
                        <td className="py-2 pr-4">{money(h.currency, h.amount)}</td>
                        <td className="py-2 pr-4">{h.status === 'captured' ? 'Paid' : optionLabel(h.status)}</td>
                        <td className="py-2 font-mono text-xs text-slate-400">{h.invoiceId || h.paymentId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <BillingDetailsCard api={profileApi} />

        <InvoiceList />

        <div className="mt-8 text-xs text-slate-500 max-w-4xl">
          To change plans, cancel your current plan first, then subscribe to another once it has ended. Closing or
          refreshing checkout never charges you twice.
        </div>
      </main>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!cancelling) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your {summary?.planName} subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              {immediateCancel
                ? summary?.status === 'trialing'
                  ? 'Your free trial ends now and you will not be charged. Paid features stop immediately.'
                  : 'The recurring payment is cancelled now and you will not be charged again. Paid features stop immediately.'
                : `You will not be charged again. Your ${summary?.planName} features stay available until ${day(summary?.currentPeriodEnd) || 'the end of the current billing period'}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(event) => {
                event.preventDefault();
                cancel();
              }}
            >
              {cancelling ? 'Cancelling…' : immediateCancel ? 'Cancel now' : 'Cancel at period end'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
