import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/api';
import { openRazorpayCheckout } from '../lib/razorpayCheckout';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import type { Booking, BookingPayment, BookingPaymentOrder } from '../lib/apiTypes';
import { BookingFeeBreakdown } from './booking/BookingFeeBreakdown';
import { trackBookingDepositPaid } from '../lib/analytics';

// Requester-side deposit state and payment for one booking. The amount, currency and order
// always come from the server; the browser only relays the Razorpay handler payload back.
const money = (currency: string | null | undefined, value: unknown) =>
  `${currency || 'INR'} ${Number(value || 0).toLocaleString('en-IN')}`;

export function BookingDepositPanel({ booking, onChanged }: { booking: Booking; onChanged: () => unknown }) {
  const [payments, setPayments] = useState<BookingPayment[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
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
        toast.success('Mock deposit recorded');
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
      toast.error(errorMessage(e));
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
  return (
    <div className="flex flex-col items-start gap-3 w-full max-w-sm">
      {quote && <BookingFeeBreakdown booking={booking} quote={quote} depositAmount={baseDeposit} />}
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
