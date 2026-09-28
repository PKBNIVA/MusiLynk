import type { Booking, BookingQuote } from '../../lib/apiTypes';

const money = (currency: string | null | undefined, value: unknown) =>
  `${currency || 'INR'} ${Number(value || 0).toLocaleString('en-IN')}`;

/**
 * "What you pay" breakdown (deposit, platform fee, GST, total) and the cancellation/no-show
 * rules in plain words, sourced entirely from the server (BookingFeePolicy via
 * BookingsController#booking_json) so this never drifts from config/bookings.yml. Shown before
 * checkout on the deposit panel, and on the booking detail page for both the hirer and the
 * musician (act owner) before either side confirms.
 */
export function BookingFeeBreakdown({
  booking,
  quote,
  depositAmount,
}: {
  booking: Booking;
  quote?: BookingQuote | null;
  /** The base deposit (before fee/GST), e.g. quote.total * quote.depositPercent / 100. */
  depositAmount?: number | null;
}) {
  const policy = booking.bookingPolicy;
  const currency = quote?.currency || booking.currency;
  const feeAmount = quote?.feeAmount ?? 0;
  const gstAmount = quote?.gstAmount ?? 0;
  const hasFee = !!policy?.feeEnabled && (feeAmount > 0 || gstAmount > 0);
  const total = (depositAmount ?? 0) + feeAmount + gstAmount;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[.03] p-4 space-y-3" data-testid="booking-fee-breakdown">
      {depositAmount != null && (
        <div>
          <div className="text-sm font-medium text-slate-200 mb-1.5">What you pay</div>
          <dl className="text-sm text-slate-300 space-y-1">
            <div className="flex justify-between">
              <dt>Deposit</dt>
              <dd data-testid="breakdown-deposit">{money(currency, depositAmount)}</dd>
            </div>
            {hasFee && (
              <>
                <div className="flex justify-between">
                  <dt>Platform fee ({quote?.feePercent ?? 0}%)</dt>
                  <dd data-testid="breakdown-fee">{money(currency, feeAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>GST on fee</dt>
                  <dd data-testid="breakdown-gst">{money(currency, gstAmount)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold text-slate-100 pt-1 border-t border-white/10">
              <dt>Total due now</dt>
              <dd data-testid="breakdown-total">{money(currency, total)}</dd>
            </div>
          </dl>
        </div>
      )}
      {policy && policy.plainEnglish.length > 0 && (
        <div>
          <div className="text-sm font-medium text-slate-200 mb-1.5">Cancellation & no-show rules</div>
          <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4" data-testid="cancellation-rules">
            {policy.plainEnglish.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="text-[11px] text-slate-500 mt-1.5">Policy version {policy.policyVersion}</div>
        </div>
      )}
    </div>
  );
}
