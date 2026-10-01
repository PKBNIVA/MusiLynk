import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { openRazorpayCheckout } from '../lib/razorpayCheckout';
import { Button } from './ui/button';
import { PaymentsNotify } from './PaymentsNotify';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { errorCode, errorMessage, errorStatus } from '../lib/errors';
import { formatMoney } from '../lib/format';
import { usePaymentMode } from '../lib/paymentMode';
import type { Booking, BookingPayment, BookingPaymentOrder } from '../lib/apiTypes';
import { trackBookingDepositPaid } from '../lib/analytics';

// Requester-side deposit state and payment for one booking. The amount, currency and order
// always come from the server; the browser only relays the Razorpay handler payload back.
const money = (currency: string | null | undefined, value: unknown) =>
  formatMoney(Number(value || 0), currency || 'INR');

export function BookingDepositPanel({ booking, onChanged }: { booking: Booking; onChanged: () => unknown }) {
  const [payments, setPayments] = useState<BookingPayment[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
  // Online payment is switched off here: said up front when known, or learned from the order call (A-10).
  const paymentMode = usePaymentMode();
  const [refused, setRefused] = useState(false);
  const unavailable = paymentMode === 'disabled' || refused;
  const inFlight = useRef(false);
  const eligible = booking.isRequester && ['accepted', 'completed', 'disputed'].includes(booking.status);

  const refresh = useCallback(
    () =>
      apiGet<{ payments?: BookingPayment[] }>(`/bookings/${booking.id}/payments`)
        .then((d) => setPayments(d.payments || []))
        .catch(() => setPayments([])),
    [booking.id],
  );
  // status and paymentCount are not read here: a change to either means the payments changed.
  useEffect(() => {
    if (eligible) refresh();
  }, [refresh, booking.status, booking.paymentCount, eligible]);

  if (!eligible) return null;
  const deposit = (payments || []).find(
    (p) => p.kind === 'deposit' && ['paid', 'refunded', 'created'].includes(p.status),
  );
  const quote = booking.latestQuote;
  const baseDeposit = quote ? Math.round((quote.total * quote.depositPercent) / 100) : null;
  // The server charges the deposit plus the platform fee/GST in one payment; showing that same
  // total here (not just the base deposit) keeps this button's label truthful.
  const expected = baseDeposit != null ? baseDeposit + (quote?.feeAmount ?? 0) + (quote?.gstAmount ?? 0) : null;

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPaying(true);
    setDeclined(null);
    try {
      const d = await apiPost<BookingPaymentOrder>(`/bookings/${booking.id}/payment-order`, {});
      if (d.checkout?.mode === 'mock') {
        await apiPost(`/booking-payments/${d.payment.id}/confirm`, {});
        trackBookingDepositPaid();
        toast.success('Deposit recorded');
      } else {
        const result = await openRazorpayCheckout(d.checkout, {
          description: `Booking deposit · ${booking.actName}`,
          amountLabel: money(d.payment.currency, d.payment.amount),
        });
        if (result.status === 'success') {
          const r = result.response;
          await apiPost(`/booking-payments/${d.payment.id}/confirm`, {
            orderId: r.razorpay_order_id,
            paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature,
          });
          trackBookingDepositPaid();
          toast.success('Deposit paid. Your booking is confirmed.');
        } else if (result.lastError) {
          setDeclined(result.lastError);
          toast.error(`Payment declined: ${result.lastError}`);
        } else {
          toast.info('Checkout closed. Nothing was charged.');
        }
      }
    } catch (e: unknown) {
      if (errorCode(e) === 'PAYMENTS_UNAVAILABLE' || errorStatus(e) === 503) setRefused(true);
      else toast.error(errorMessage(e));
    } finally {
      inFlight.current = false;
      setPaying(false);
      await refresh();
      await onChanged();
    }
  }

  if (payments === null) return <span className="text-xs text-slate-500">Checking deposit…</span>;
  if (deposit?.status === 'paid')
    return (
      <Badge className="bg-emerald-500/15 text-emerald-200 border-emerald-400/30" data-testid="deposit-status">
        Deposit paid · booking confirmed
      </Badge>
    );
  if (deposit?.status === 'refunded')
    return (
      <Badge className="bg-sky-500/15 text-sky-200 border-sky-400/30" data-testid="deposit-status">
        Deposit refunded · {money(deposit.currency, deposit.amount)}
      </Badge>
    );
  if (booking.status !== 'accepted') return null;
  if (unavailable)
    return (
      <div
        role="status"
        data-testid="deposit-unavailable"
        className="w-full max-w-sm rounded-xl border border-amber-400/25 bg-amber-500/[.07] p-3 text-sm text-amber-100"
      >
        <p className="font-medium">Payments open soon</p>
        <p className="mt-1 text-amber-100/80">
          Your booking is accepted and {booking.actName} has been told. Until the
          {expected ? ` ${money(quote?.currency, expected)} deposit` : ' deposit'} can be paid here, message{' '}
          {booking.actName} to agree the next step.
        </p>
        <PaymentsNotify />
        {refused && (
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setRefused(false)}>
            Check again
          </Button>
        )}
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-3 w-full max-w-sm">
      <Button size="sm" disabled={paying} aria-busy={paying} onClick={pay}>
        {paying
          ? 'Processing payment…'
          : `${declined ? 'Retry deposit' : deposit?.status === 'created' ? 'Resume deposit payment' : 'Pay deposit'}${expected ? ` · ${money(quote?.currency, expected)}` : ''}`}
      </Button>
      {declined && (
        <span role="alert" className="text-xs text-rose-300" data-testid="deposit-declined">
          Payment declined: {declined}
        </span>
      )}
    </div>
  );
}
