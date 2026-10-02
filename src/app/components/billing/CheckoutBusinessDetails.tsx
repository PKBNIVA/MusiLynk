import { ChevronDown } from 'lucide-react';
import { BillingDetailsForm } from './BillingDetailsForm';
import { cn } from '../ui/utils';
import type { BillingProfileDraft, BillingProfileErrors } from '../../lib/billingProfile';

/**
 * "Buying for a business? Add GST details", folded away by default so an individual is not slowed
 * down. Billing.tsx saves it before it starts checkout (see commitBusinessDetails there).
 */
export function CheckoutBusinessDetails({
  open,
  onToggle,
  draft,
  errors,
  states,
  onChange,
  savedName,
}: {
  open: boolean;
  onToggle: () => void;
  draft: BillingProfileDraft;
  errors: BillingProfileErrors;
  states: Array<{ code: string; name: string }>;
  onChange: <K extends keyof BillingProfileDraft>(key: K, value: BillingProfileDraft[K]) => void;
  savedName?: string;
}) {
  return (
    <section className="mt-7 rounded-xl border border-white/10 bg-white/[.03]" data-testid="checkout-business">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="checkout-business-panel"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium"
      >
        <span>
          Buying for a business? Add GST details
          {savedName && <span className="ml-2 font-normal text-slate-400">Invoices are made out to {savedName}.</span>}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id="checkout-business-panel" className="border-t border-white/10 p-4">
          <p className="mb-4 text-sm text-slate-300">
            We will print these on your invoice so you can claim input tax credit. They are saved to your account when
            you start checkout.
          </p>
          <BillingDetailsForm
            idPrefix="cb"
            draft={draft}
            errors={errors}
            states={states}
            onChange={onChange}
            fixedBusiness
          />
        </div>
      )}
    </section>
  );
}
