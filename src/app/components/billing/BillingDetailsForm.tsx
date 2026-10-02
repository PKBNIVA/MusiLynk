import { Field } from '../form/Field';
import { Input } from '../ui/input';
import { cn } from '../ui/utils';
import type { BillingProfileDraft, BillingProfileErrors } from '../../lib/billingProfile';

const selectClass =
  'flex h-11 w-full rounded-xl border border-input bg-input-background px-3.5 text-base outline-none transition-[color,box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-white/[.045] md:text-sm';

type Props = {
  idPrefix: string;
  draft: BillingProfileDraft;
  errors: BillingProfileErrors;
  states: Array<{ code: string; name: string }>;
  onChange: <K extends keyof BillingProfileDraft>(key: K, value: BillingProfileDraft[K]) => void;
  /** Hide the individual/business switch (the checkout section is business-only). */
  fixedBusiness?: boolean;
};

/**
 * The billing details fields. Individuals give a name and address; businesses add GSTIN (or PAN)
 * and an optional PO number. Checks mirror the API's (see lib/billingProfile.ts).
 */
export function BillingDetailsForm({ idPrefix, draft, errors, states, onChange, fixedBusiness }: Props) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const business = draft.buyerType === 'business';
  return (
    <div className="space-y-4" data-testid={`${idPrefix}-form`}>
      {!fixedBusiness && (
        <fieldset>
          <legend className="text-sm font-medium text-slate-300">I am buying as</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['individual', 'business'] as const).map((type) => (
              <label
                key={type}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm',
                  draft.buyerType === type ? 'border-violet-400 bg-violet-500/10' : 'border-white/10',
                )}
              >
                <input
                  type="radio"
                  name={id('buyer-type')}
                  value={type}
                  checked={draft.buyerType === type}
                  onChange={() => onChange('buyerType', type)}
                />
                {type === 'individual' ? 'An individual' : 'A business'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field
        id={id('legal-name')}
        label={business ? 'Business name' : 'Name'}
        required
        error={errors.legalName}
        hint="Printed on the invoice."
      >
        <Input
          value={draft.legalName}
          autoComplete="organization"
          maxLength={120}
          onChange={(e) => onChange('legalName', e.target.value)}
        />
      </Field>
      {business && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={id('gstin')}
            label="GSTIN"
            optional
            error={errors.gstin}
            hint="15 characters. Leave blank if you are not GST-registered."
          >
            <Input
              value={draft.gstin}
              maxLength={20}
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono uppercase"
              onChange={(e) => onChange('gstin', e.target.value.toUpperCase())}
            />
          </Field>
          <Field id={id('pan')} label="PAN" optional error={errors.pan} hint="For businesses without a GSTIN.">
            <Input
              value={draft.pan}
              maxLength={12}
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono uppercase"
              onChange={(e) => onChange('pan', e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      )}
      <Field id={id('address-1')} label="Address line 1" required error={errors.addressLine1}>
        <Input
          value={draft.addressLine1}
          autoComplete="address-line1"
          maxLength={120}
          onChange={(e) => onChange('addressLine1', e.target.value)}
        />
      </Field>
      <Field id={id('address-2')} label="Address line 2" optional>
        <Input
          value={draft.addressLine2}
          autoComplete="address-line2"
          maxLength={120}
          onChange={(e) => onChange('addressLine2', e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('city')} label="City" required error={errors.city}>
          <Input
            value={draft.city}
            autoComplete="address-level2"
            maxLength={80}
            onChange={(e) => onChange('city', e.target.value)}
          />
        </Field>
        <Field id={id('state')} label="State" required error={errors.stateCode}>
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={draft.stateCode}
              autoComplete="address-level1"
              onChange={(e) => onChange('stateCode', e.target.value)}
            >
              <option value="">Choose your state</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('pin')} label="PIN code" required error={errors.postalCode}>
          <Input
            value={draft.postalCode}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={7}
            onChange={(e) => onChange('postalCode', e.target.value.replace(/[^\d ]/g, ''))}
          />
        </Field>
        <Field id={id('country')} label="Country">
          <Input value="India" readOnly disabled />
        </Field>
      </div>
      <Field
        id={id('email')}
        label="Billing email"
        error={errors.billingEmail}
        hint="Shown on your invoices. Defaults to your account email."
      >
        <Input
          type="email"
          value={draft.billingEmail}
          autoComplete="email"
          maxLength={254}
          onChange={(e) => onChange('billingEmail', e.target.value)}
        />
      </Field>
      {business && (
        <Field
          id={id('po')}
          label="PO or reference number"
          optional
          error={errors.poReference}
          hint="Printed on the invoice for your accounts team."
        >
          <Input value={draft.poReference} maxLength={40} onChange={(e) => onChange('poReference', e.target.value)} />
        </Field>
      )}
    </div>
  );
}
