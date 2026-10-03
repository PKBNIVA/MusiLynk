import { ShareMenu } from '../components/ShareMenu';
import { shareCopy } from '../lib/share';
import { EmptyState as SceneEmptyState } from '../components/kit/EmptyState';
import { CoverArt } from '../components/media/CoverArt';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { apiGet, apiPost } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { FormDialog, textareaClass, useConfirm } from '../components/booking/BookingDialogs';
import { Field, RequiredNote } from '../components/form/Field';
import { useFormErrors, useSubmitOnce } from '../lib/formErrors';
import { toast } from 'sonner';
import { BookingDepositPanel } from '../components/BookingDepositPanel';
import { BookingFeeBreakdown } from '../components/booking/BookingFeeBreakdown';
import { trackBookingQuoteAccepted, trackBookingQuoteSent } from '../lib/analytics';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney, formatWhen, formatInputEcho } from '../lib/format';
import type { Booking, BookingPayment, ConversationCreated } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';
import { optionLabel } from '../components/ui/option-labels';

const money = (currency: string | null | undefined, value: unknown) =>
  formatMoney(Number(value || 0), currency || 'INR');
const eventDate = (value: string | null | undefined) => formatDate(value, { fallback: 'Date to be confirmed' });

// Mirrors BookingRequest::OWNER_TRANSITIONS / REQUESTER_TRANSITIONS; the API also sends allowedTransitions.
const OWNER_TRANSITIONS: Record<string, string[]> = {
  requested: ['viewed', 'negotiating', 'declined'],
  viewed: ['negotiating', 'declined'],
  quoted: ['negotiating', 'declined'],
  negotiating: ['declined'],
  accepted: ['completed', 'disputed'],
};
const REQUESTER_TRANSITIONS: Record<string, string[]> = {
  requested: ['negotiating', 'cancelled'],
  viewed: ['negotiating', 'cancelled'],
  quoted: ['accepted', 'negotiating', 'cancelled'],
  negotiating: ['accepted', 'cancelled'],
  accepted: ['cancelled', 'disputed'],
};
const QUOTABLE = ['requested', 'viewed', 'negotiating', 'quoted'];
const STATUS_LABEL: Record<string, string> = {
  requested: 'Enquiry sent',
  viewed: 'Viewed',
  quoted: 'Quote received',
  negotiating: 'Negotiating',
  accepted: 'Accepted · deposit due',
  completed: 'Completed',
  disputed: 'In dispute',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

function allowed(b: Booking): string[] {
  if (Array.isArray(b.allowedTransitions)) return b.allowedTransitions;
  return (b.isOwner ? OWNER_TRANSITIONS : REQUESTER_TRANSITIONS)[b.status] || [];
}
function statusLabel(b: Booking) {
  if (b.status === 'accepted' && b.depositPaid) return 'Confirmed · deposit paid';
  return STATUS_LABEL[b.status] || b.status;
}
function nextStep(b: Booking): string {
  const quoted = Boolean(b.latestQuote);
  if (b.isOwner) {
    if (['requested', 'viewed'].includes(b.status)) return 'Send a quote or decline this enquiry.';
    if (b.status === 'negotiating') return 'The client asked for changes. Send a revised quote.';
    if (b.status === 'quoted') return 'Waiting for the client to accept your quote.';
    if (b.status === 'accepted')
      return b.depositPaid
        ? 'Deposit received. Mark the booking completed after the event.'
        : 'Waiting for the client to pay the deposit.';
  } else {
    if (['requested', 'viewed'].includes(b.status)) return 'Waiting for the act to send a quote.';
    if (b.status === 'negotiating')
      return quoted
        ? 'You asked for changes. Accept the current quote or wait for a revised one.'
        : 'Waiting for the act to send a quote.';
    if (b.status === 'quoted') return 'Review the quote, then accept it or ask for changes.';
    if (b.status === 'accepted')
      return b.depositPaid ? 'Your booking is confirmed.' : 'Pay the deposit to confirm the booking.';
  }
  return '';
}

type QuoteForm = {
  id: string;
  requesterName: string;
  performanceFee: string;
  travelFee: string;
  productionFee: string;
  otherFee: string;
  currency: string;
  depositPercent: string;
  validUntil: string;
  inclusions: string;
  exclusions: string;
  cancellationTerms: string;
};
const wholeNumber = (value: string) => /^\d+$/.test(value.trim());
type QuoteField =
  | 'performanceFee'
  | 'travelFee'
  | 'productionFee'
  | 'otherFee'
  | 'currency'
  | 'depositPercent'
  | 'validUntil'
  | 'cancellationTerms';
const QUOTE_IDS: Record<QuoteField, string> = {
  performanceFee: 'quote-performance',
  travelFee: 'quote-travel',
  productionFee: 'quote-production',
  otherFee: 'quote-other',
  currency: 'quote-currency',
  depositPercent: 'quote-deposit',
  validUntil: 'quote-valid',
  cancellationTerms: 'quote-cancellation',
};
const QUOTE_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
/** Every problem with the quote at once, per field. */
function quoteProblems(q: QuoteForm) {
  const errors: Partial<Record<QuoteField, string>> = {};
  if (!wholeNumber(q.performanceFee) || Number(q.performanceFee) <= 0)
    errors.performanceFee = 'Enter a performance fee as a whole number above zero.';
  for (const [key, label] of [
    ['travelFee', 'Travel'],
    ['productionFee', 'Production'],
    ['otherFee', 'Other'],
  ] as const) {
    if (q[key].trim() && !wholeNumber(q[key])) errors[key] = `${label} fee must be a whole number of 0 or more.`;
  }
  if (!/^[A-Z]{3}$/.test(q.currency.trim())) errors.currency = 'Choose a currency.';
  if (!wholeNumber(q.depositPercent) || Number(q.depositPercent) < 1 || Number(q.depositPercent) > 100)
    errors.depositPercent = 'Deposit must be between 1% and 100%.';
  if (q.validUntil && new Date(`${q.validUntil}T23:59:59`).getTime() <= Date.now())
    errors.validUntil = 'The quote must stay valid until a future date.';
  if (!q.cancellationTerms.trim()) errors.cancellationTerms = 'Add cancellation and refund terms.';
  return errors;
}

export default function Bookings() {
  const base = `/${useLocation().pathname.split('/')[1] || 'employer'}`;
  const [rows, setRows] = useState<Booking[]>([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [quote, setQuote] = useState<QuoteForm | null>(null),
    [payments, setPayments] = useState<Record<string, BookingPayment[]>>({}),
    [paymentOpen, setPaymentOpen] = useState<Record<string, boolean>>({});
  const nav = useNavigate();
  const { ask, element: confirmDialog } = useConfirm();
  const [changes, setChanges] = useState<{ booking: Booking; message: string } | null>(null),
    [changesError, setChangesError] = useState('');
  const changesSubmit = useSubmitOnce();
  const quoteErrors = useFormErrors<QuoteField>({ ids: QUOTE_IDS });
  const quoteSubmit = useSubmitOnce();
  const sendingQuote = quoteSubmit.busy;
  async function load() {
    try {
      const d = await apiGet<{ bookings?: Booking[] }>('/bookings');
      setRows(d.bookings || []);
      setLoadError('');
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Unable to load bookings.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function changeStatus(id: string, s: string, success: string, noShow?: 'musician' | 'hirer', message?: string) {
    const res = await apiPost<{
      refund?: { amount: number; currency: string; note: string } | null;
      conversationId?: string | null;
    }>(`/bookings/${id}/status`, { status: s, ...(noShow ? { noShow } : {}), ...(message ? { message } : {}) });
    if (s === 'accepted') trackBookingQuoteAccepted();
    toast.success(res.refund ? `${success} · ${res.refund.note}` : success, {
      action: res.conversationId
        ? { label: 'Open conversation', onClick: () => nav(`${base}/messages?c=${res.conversationId}`) }
        : undefined,
    });
    await load();
  }
  function sendQuote() {
    if (!quote) return;
    return quoteSubmit.run(async () => {
      quoteErrors.setFormError('');
      if (quoteErrors.setErrors(quoteProblems(quote))) {
        quoteErrors.focusFirst();
        return;
      }
      try {
        await apiPost(`/bookings/${quote.id}/quote`, {
          performanceFee: Number(quote.performanceFee),
          travelFee: Number(quote.travelFee) || 0,
          productionFee: Number(quote.productionFee) || 0,
          otherFee: Number(quote.otherFee) || 0,
          currency: quote.currency.trim() || 'INR',
          depositPercent: Number(quote.depositPercent) || 50,
          validUntil: quote.validUntil || null,
          inclusions: quote.inclusions,
          exclusions: quote.exclusions,
          cancellationTerms: quote.cancellationTerms,
        });
        trackBookingQuoteSent();
        toast.success('Quote sent');
        setQuote(null);
        await load();
      } catch (e: unknown) {
        if (quoteErrors.setFromApi(e, 'Unable to send the quote.')) quoteErrors.focusFirst();
      }
    });
  }
  async function togglePayments(id: string) {
    if (paymentOpen[id]) {
      setPaymentOpen((x) => ({ ...x, [id]: false }));
      return;
    }
    try {
      const d = await apiGet<{ payments?: BookingPayment[] }>(`/bookings/${id}/payments`);
      setPayments((x) => ({ ...x, [id]: d.payments || [] }));
      setPaymentOpen((x) => ({ ...x, [id]: true }));
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function paymentsChanged(id: string) {
    await load();
    if (paymentOpen[id]) {
      const d = await apiGet<{ payments?: BookingPayment[] }>(`/bookings/${id}/payments`).catch(() => null);
      if (d) setPayments((x) => ({ ...x, [id]: d.payments || [] }));
    }
  }
  async function message(id: string) {
    try {
      const d = await apiPost<ConversationCreated>('/conversations', { bookingId: id });
      nav(`${base}/messages?c=${d.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  const beginQuote = (b: Booking) => {
    const last = b.latestQuote;
    quoteErrors.clear();
    setQuote({
      id: b.id,
      requesterName: b.requesterName,
      performanceFee: last ? String(last.performanceFee ?? '') : '',
      travelFee: last ? String(last.travelFee ?? '') : '',
      productionFee: last ? String(last.productionFee ?? '') : '',
      otherFee: last ? String(last.otherFee ?? '') : '',
      currency: last?.currency || b.currency || 'INR',
      depositPercent: String(last?.depositPercent ?? 50),
      validUntil: '',
      inclusions: last?.inclusions || '',
      exclusions: last?.exclusions || '',
      cancellationTerms: last?.cancellationTerms || '',
    });
  };
  const confirmStatus = (b: Booking, s: string, noShow?: 'musician' | 'hirer') => {
    const q = b.latestQuote;
    const copy: Partial<Record<string, [string, string, string, boolean]>> = {
      accepted: [
        'Accept this quote?',
        q
          ? `You agree to ${money(q.currency, q.total)} with a ${q.depositPercent}% deposit (${money(q.currency, Math.round((q.total * q.depositPercent) / 100))}) due next.`
          : 'You agree to the latest quote.',
        'Accept quote',
        false,
      ],
      cancelled: [
        b.status === 'accepted' ? 'Cancel this booking?' : 'Cancel this enquiry?',
        b.depositPaid
          ? `Your deposit is handled under MusiLynk's cancellation policy: ${b.bookingPolicy?.plainEnglish.slice(1, 4).join(' ') || "the act's cancellation terms."} This cannot be undone.`
          : 'The act is notified and the enquiry closes. This cannot be undone.',
        b.status === 'accepted' ? 'Cancel booking' : 'Cancel enquiry',
        true,
      ],
      declined: [
        'Decline this enquiry?',
        `${b.requesterName || 'The client'} will see the enquiry as declined. This cannot be undone.`,
        'Decline',
        true,
      ],
      completed: [
        'Mark this booking completed?',
        b.depositPaid
          ? 'Confirm the event took place.'
          : 'No deposit has been recorded for this booking. Only continue if the event took place.',
        'Mark completed',
        false,
      ],
      disputed: noShow
        ? [
            noShow === 'musician' ? 'Report that the musician did not show?' : 'Report that the hirer did not show?',
            b.depositPaid
              ? noShow === 'musician'
                ? 'The deposit is fully refunded and the platform fee is waived, per the cancellation policy.'
                : 'The deposit is kept, per the cancellation policy.'
              : 'The booking moves to dispute so the MusiLynk team can review it.',
            noShow === 'musician' ? 'Report musician no-show' : 'Report hirer no-show',
            true,
          ]
        : [
            'Report a problem with this booking?',
            'The booking moves to dispute so the MusiLynk team can review it.',
            'Report problem',
            true,
          ],
    };
    const [title, description, confirmLabel, destructive] = copy[s] ?? [s, '', s, false];
    const success: Record<string, string> = {
      accepted: 'Quote accepted. Pay the deposit to confirm.',
      cancelled: 'Booking cancelled',
      declined: 'Enquiry declined',
      completed: 'Booking marked completed',
      disputed: 'Problem reported',
    };
    ask({ title, description, confirmLabel, destructive, action: () => changeStatus(b.id, s, success[s], noShow) });
  };
  const askForChanges = (b: Booking) => {
    setChangesError('');
    setChanges({ booking: b, message: '' });
  };
  function sendChanges() {
    if (!changes) return;
    return changesSubmit.run(async () => {
      setChangesError('');
      try {
        await changeStatus(
          changes.booking.id,
          'negotiating',
          'Asked for a revised quote',
          undefined,
          changes.message.trim() || undefined,
        );
        setChanges(null);
      } catch (e: unknown) {
        setChangesError(errorMessage(e, 'Unable to ask for changes.'));
      }
    });
  }
  const setQ = (key: keyof QuoteForm, value: string) => {
    setQuote((current) => (current ? { ...current, [key]: value } : current));
    quoteErrors.clear(key as QuoteField);
  };
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-6xl mx-auto px-4 sm:px-5 pt-28 pb-24">
        <PageHeader title="Bookings" />
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading bookings…
          </p>
        ) : loadError ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">{loadError}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-7">
            <SceneEmptyState
              scene="calendar"
              title="No bookings yet"
              hint={
                base === '/jobseeker'
                  ? 'Bookings appear here once a hirer confirms'
                  : 'Bookings appear here once a musician accepts'
              }
              action={
                base === '/jobseeker'
                  ? { label: 'Set availability', to: `${base}/availability` }
                  : { label: 'Book talent', to: `${base}/book-talent` }
              }
            />
          </div>
        ) : (
          <div className="space-y-4 mt-7">
            {rows.map((b) => {
              const can = allowed(b);
              const hint = nextStep(b);
              return (
                <Card key={b.id} className="bg-white/[.055] border-white/10 overflow-hidden" data-testid="booking-card">
                  {/* First-fold image (§5.1.1): generated art seeded by the act, decoration only. */}
                  <div className="h-20 sm:h-24" data-testid="booking-art">
                    <CoverArt seed={b.act_id || b.id} size="fill" bars={56} className="block size-full" />
                  </div>
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2 items-center">
                          <h2 className="font-semibold text-lg break-words">{b.actName}</h2>
                          <Badge>{statusLabel(b)}</Badge>
                        </div>
                        <p className="text-sm text-slate-400 mt-2 break-words">
                          <span className="capitalize">{String(b.event_type || 'event').replace(/-/g, ' ')}</span> ·{' '}
                          {eventDate(b.event_date)} · {b.city}
                          {b.venue_name ? ` · ${b.venue_name}` : ''}
                        </p>
                        <p className="text-sm mt-2">
                          {b.isOwner ? `Enquiry from ${b.requesterName}` : 'Your booking enquiry'}
                        </p>
                        {hint && <p className="text-sm text-violet-200 mt-2">{hint}</p>}
                        {b.status === 'accepted' && (
                          <p className="text-xs text-slate-500 mt-2">
                            If the act cancels, tell us and we'll help you find a replacement through MusiLynk's{' '}
                            <Link to="/urgent" className="text-violet-300 underline">
                              urgent requests
                            </Link>
                            .
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-wrap items-start md:justify-end">
                        {b.status === 'accepted' && b.depositPaid && (
                          <ShareMenu
                            surface="booking"
                            path={`${base}/bookings`}
                            compose={(url) =>
                              shareCopy.booking(
                                b.actName,
                                formatDate(b.event_date, { fallback: 'date to be confirmed' }),
                                b.city,
                                url,
                              )
                            }
                            title={`Booking: ${b.actName}`}
                            label={b.isOwner ? 'Share with venue' : 'Share with band'}
                            testId={`share-booking-${b.id}`}
                          />
                        )}
                        {b.isOwner && QUOTABLE.includes(b.status) && (
                          <Button size="sm" onClick={() => beginQuote(b)}>
                            {b.latestQuote ? 'Revise quote' : 'Send quote'}
                          </Button>
                        )}
                        {b.isRequester && can.includes('accepted') && b.latestQuote && (
                          <Button size="sm" onClick={() => confirmStatus(b, 'accepted')}>
                            Accept quote
                          </Button>
                        )}
                        {b.isRequester && b.status === 'quoted' && can.includes('negotiating') && (
                          <Button size="sm" variant="outline" onClick={() => askForChanges(b)}>
                            Ask for changes
                          </Button>
                        )}
                        <BookingDepositPanel booking={b} onChanged={() => paymentsChanged(b.id)} />
                        {can.includes('completed') && (
                          <Button size="sm" onClick={() => confirmStatus(b, 'completed')}>
                            Mark completed
                          </Button>
                        )}
                        {can.includes('declined') && (
                          <Button size="sm" variant="outline" onClick={() => confirmStatus(b, 'declined')}>
                            Decline
                          </Button>
                        )}
                        {can.includes('cancelled') && (
                          <Button size="sm" variant="outline" onClick={() => confirmStatus(b, 'cancelled')}>
                            {b.status === 'accepted' ? 'Cancel booking' : 'Cancel enquiry'}
                          </Button>
                        )}
                        {can.includes('disputed') && b.depositPaid && b.isRequester && (
                          <Button size="sm" variant="ghost" onClick={() => confirmStatus(b, 'disputed', 'musician')}>
                            Report musician no-show
                          </Button>
                        )}
                        {can.includes('disputed') && b.depositPaid && b.isOwner && (
                          <Button size="sm" variant="ghost" onClick={() => confirmStatus(b, 'disputed', 'hirer')}>
                            Report hirer no-show
                          </Button>
                        )}
                        {can.includes('disputed') && !b.depositPaid && (
                          <Button size="sm" variant="ghost" onClick={() => confirmStatus(b, 'disputed')}>
                            Report a problem
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="max-w-full min-w-0"
                          onClick={() => message(b.id)}
                        >
                          <span className="truncate max-w-[16rem]">
                            Message {b.isOwner ? b.requesterName : b.actName}
                          </span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => togglePayments(b.id)}
                          aria-expanded={Boolean(paymentOpen[b.id])}
                        >
                          {paymentOpen[b.id] ? 'Hide payments' : 'Payment history'} ({b.paymentCount || 0})
                        </Button>
                      </div>
                    </div>
                    {b.latestQuote && (
                      <section className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-wrap justify-between gap-2">
                          <h3 className="font-semibold">
                            Latest quote · {money(b.latestQuote.currency, b.latestQuote.total)}
                          </h3>
                          <span className="text-sm text-emerald-300">
                            Deposit {b.latestQuote.depositPercent}%
                            {b.latestQuote.validUntil ? ` · valid until ${formatDate(b.latestQuote.validUntil)}` : ''}
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs text-slate-400">
                          <span>Performance: {money(b.latestQuote.currency, b.latestQuote.performanceFee)}</span>
                          <span>Travel: {money(b.latestQuote.currency, b.latestQuote.travelFee)}</span>
                          <span>Production: {money(b.latestQuote.currency, b.latestQuote.productionFee)}</span>
                          <span>Other: {money(b.latestQuote.currency, b.latestQuote.otherFee)}</span>
                        </div>
                        {b.latestQuote.inclusions && (
                          <p className="text-sm mt-3 break-words">
                            <b>Includes:</b> {b.latestQuote.inclusions}
                          </p>
                        )}
                        {b.latestQuote.exclusions && (
                          <p className="text-sm mt-2 break-words">
                            <b>Excludes:</b> {b.latestQuote.exclusions}
                          </p>
                        )}
                        {b.latestQuote.cancellationTerms && (
                          <p className="text-sm mt-2 break-words">
                            <b>Cancellation:</b> {b.latestQuote.cancellationTerms}
                          </p>
                        )}
                        <div className="mt-3">
                          <BookingFeeBreakdown
                            booking={b}
                            quote={b.latestQuote}
                            depositAmount={Math.round((b.latestQuote.total * b.latestQuote.depositPercent) / 100)}
                          />
                        </div>
                      </section>
                    )}
                    {paymentOpen[b.id] && (
                      <section className="mt-4 border-t border-white/10 pt-4">
                        <h3 className="font-semibold text-sm">Payment history</h3>
                        {(payments[b.id] || []).length === 0 ? (
                          <p className="text-sm text-slate-500 mt-2">No payments recorded.</p>
                        ) : (
                          <div className="space-y-2 mt-2">
                            {payments[b.id].map((p) => (
                              <div
                                key={p.id}
                                className="flex flex-wrap justify-between gap-2 text-sm rounded-lg bg-white/[.04] p-3"
                              >
                                <span>
                                  {optionLabel(p.kind)} · {money(p.currency, p.amount)}
                                </span>
                                <span className="flex items-center gap-3">
                                  {optionLabel(p.status)} · {formatWhen(p.created_at)}
                                  {p.invoiceId && (
                                    <Link
                                      to={`${base}/invoices/${p.invoiceId}/print`}
                                      className="text-violet-300 hover:text-violet-200 underline underline-offset-4"
                                    >
                                      Invoice
                                    </Link>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        <FormDialog
          open={Boolean(quote)}
          onOpenChange={(open) => !open && setQuote(null)}
          title={`Quote ${quote?.requesterName || ''}`.trim()}
          description="Every quote is a new version; the client sees the latest one."
          submitLabel="Send quote"
          busyLabel="Sending…"
          busy={sendingQuote}
          error={quoteErrors.formError}
          wide
          onSubmit={sendQuote}
        >
          {quote && (
            <>
              <RequiredNote />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field
                  id={QUOTE_IDS.performanceFee}
                  label="Performance fee"
                  required
                  error={quoteErrors.errors.performanceFee}
                >
                  <Input
                    inputMode="numeric"
                    type="number"
                    min="1"
                    value={quote.performanceFee}
                    onChange={(e) => setQ('performanceFee', e.target.value)}
                  />
                </Field>
                <Field id={QUOTE_IDS.currency} label="Currency" required error={quoteErrors.errors.currency}>
                  <AppSelect
                    className="h-11 rounded-xl"
                    value={quote.currency}
                    onValueChange={(v) => setQ('currency', v)}
                    options={
                      QUOTE_CURRENCIES.includes(quote.currency)
                        ? QUOTE_CURRENCIES
                        : [quote.currency, ...QUOTE_CURRENCIES]
                    }
                  />
                </Field>
                <Field
                  id={QUOTE_IDS.travelFee}
                  label="Travel fee"
                  optional
                  error={quoteErrors.errors.travelFee}
                  help="Flights, trains or fuel for the whole lineup and gear. Listing it separately keeps the quote clear."
                >
                  <Input
                    inputMode="numeric"
                    type="number"
                    min="0"
                    value={quote.travelFee}
                    onChange={(e) => setQ('travelFee', e.target.value)}
                  />
                </Field>
                <Field
                  id={QUOTE_IDS.productionFee}
                  label="Production fee"
                  optional
                  error={quoteErrors.errors.productionFee}
                >
                  <Input
                    inputMode="numeric"
                    type="number"
                    min="0"
                    value={quote.productionFee}
                    onChange={(e) => setQ('productionFee', e.target.value)}
                  />
                </Field>
                <Field id={QUOTE_IDS.otherFee} label="Other fee" optional error={quoteErrors.errors.otherFee}>
                  <Input
                    inputMode="numeric"
                    type="number"
                    min="0"
                    value={quote.otherFee}
                    onChange={(e) => setQ('otherFee', e.target.value)}
                  />
                </Field>
                <Field
                  id={QUOTE_IDS.depositPercent}
                  label="Deposit %"
                  required
                  error={quoteErrors.errors.depositPercent}
                >
                  <Input
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max="100"
                    value={quote.depositPercent}
                    onChange={(e) => setQ('depositPercent', e.target.value)}
                  />
                </Field>
                <Field
                  id={QUOTE_IDS.validUntil}
                  label="Valid until"
                  optional
                  hint={formatInputEcho(quote.validUntil)}
                  error={quoteErrors.errors.validUntil}
                  help="After this date the client can no longer accept the quote, so your calendar is not held forever."
                >
                  <Input
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={quote.validUntil}
                    onChange={(e) => setQ('validUntil', e.target.value)}
                  />
                </Field>
              </div>
              <Field id="quote-inclusions" label="What the quote includes" optional>
                <textarea
                  className={textareaClass}
                  value={quote.inclusions}
                  onChange={(e) => setQ('inclusions', e.target.value)}
                />
              </Field>
              <Field id="quote-exclusions" label="What is excluded" optional>
                <textarea
                  className={textareaClass}
                  value={quote.exclusions}
                  onChange={(e) => setQ('exclusions', e.target.value)}
                />
              </Field>
              <Field
                id={QUOTE_IDS.cancellationTerms}
                label="Cancellation and refund terms"
                required
                error={quoteErrors.errors.cancellationTerms}
              >
                <textarea
                  className={textareaClass}
                  value={quote.cancellationTerms}
                  onChange={(e) => setQ('cancellationTerms', e.target.value)}
                />
              </Field>
            </>
          )}
        </FormDialog>
        <FormDialog
          open={Boolean(changes)}
          onOpenChange={(open) => !open && setChanges(null)}
          title="Ask for changes"
          description={`${changes?.booking.actName || 'The act'} is told you want a revised quote.`}
          submitLabel="Ask for changes"
          busyLabel="Sending…"
          busy={changesSubmit.busy}
          error={changesError}
          onSubmit={sendChanges}
        >
          <Field
            id="changes-message"
            label="What should change?"
            optional
            help="Sent to them in Messages with your request."
          >
            <textarea
              className={textareaClass}
              maxLength={1000}
              placeholder="A shorter set, a lower price, a different date…"
              value={changes?.message || ''}
              onChange={(e) => setChanges((current) => (current ? { ...current, message: e.target.value } : current))}
            />
          </Field>
        </FormDialog>
        {confirmDialog}
      </main>
    </div>
  );
}
