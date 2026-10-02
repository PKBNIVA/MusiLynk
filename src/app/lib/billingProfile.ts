import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, apiPut } from './api';

// Billing details for invoices: types, the same checks the API makes (so mistakes show before
// Save), and paise formatting for invoice figures. The API stays the source of truth.

export type BuyerType = 'individual' | 'business';

export type BillingProfile = {
  buyerType: BuyerType;
  legalName: string;
  gstin: string;
  pan: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateCode: string;
  state?: string;
  postalCode: string;
  country: string;
  billingEmail: string;
  poReference: string;
  version?: number;
};

export type BillingProfileState = {
  profile: BillingProfile | null;
  states: Array<{ code: string; name: string }>;
  defaults: { legalName: string; billingEmail: string };
};

export type BillingProfileDraft = Omit<BillingProfile, 'state' | 'version' | 'country'>;
export type BillingProfileErrors = Partial<Record<keyof BillingProfileDraft, string>>;

export const emptyDraft = (
  defaults?: { legalName: string; billingEmail: string },
  buyerType: BuyerType = 'individual',
): BillingProfileDraft => ({
  buyerType,
  legalName: defaults?.legalName ?? '',
  gstin: '',
  pan: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateCode: '',
  postalCode: '',
  billingEmail: defaults?.billingEmail ?? '',
  poReference: '',
});

export const draftFrom = (profile: BillingProfile): BillingProfileDraft => ({
  buyerType: profile.buyerType,
  legalName: profile.legalName,
  gstin: profile.gstin,
  pan: profile.pan,
  addressLine1: profile.addressLine1,
  addressLine2: profile.addressLine2,
  city: profile.city,
  stateCode: profile.stateCode,
  postalCode: profile.postalCode,
  billingEmail: profile.billingEmail,
  poReference: profile.poReference,
});

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;
export const normaliseGstin = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** The GSTIN check character: base-36 weighted sum over the first 14 characters. */
export function gstinCheckCharacter(firstFourteen: string): string {
  let sum = 0;
  for (let i = 0; i < firstFourteen.length; i += 1) {
    const product = ALPHABET.indexOf(firstFourteen[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

/** A plain-language problem with the GSTIN, or '' when it is well formed. */
export function gstinProblem(raw: string): string {
  const gstin = normaliseGstin(raw);
  if (!GSTIN_SHAPE.test(gstin)) return 'Enter a 15-character GSTIN, like 27AAPFU0939F1ZV.';
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14])
    return 'This GSTIN does not look right. Check the last character.';
  return '';
}

export const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const PIN_SHAPE = /^[1-9]\d{5}$/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9 \-_./#]*$/;

export function validateDraft(
  draft: BillingProfileDraft,
  states: Array<{ code: string; name: string }>,
): BillingProfileErrors {
  const errors: BillingProfileErrors = {};
  const name = draft.legalName.trim();
  if (!name) errors.legalName = 'Enter the name to print on the invoice.';
  else if (name.length < 2 || name.length > 120) errors.legalName = 'Use 2 to 120 characters.';
  if (!draft.addressLine1.trim()) errors.addressLine1 = 'Enter the first line of your address.';
  if (!draft.city.trim()) errors.city = 'Enter your city.';
  if (!states.some((s) => s.code === draft.stateCode)) errors.stateCode = 'Choose your state.';
  if (!PIN_SHAPE.test(draft.postalCode.replace(/\s+/g, ''))) errors.postalCode = 'Enter a 6-digit PIN code.';
  if (draft.billingEmail.trim() && !EMAIL_SHAPE.test(draft.billingEmail.trim()))
    errors.billingEmail = 'Enter a valid email address.';
  if (draft.poReference.trim() && !PO_SHAPE.test(draft.poReference.trim()))
    errors.poReference = 'Use letters, numbers and - _ . / # only.';
  if (draft.buyerType === 'business') {
    const gstin = normaliseGstin(draft.gstin);
    const pan = draft.pan.replace(/\s+/g, '').toUpperCase();
    if (gstin) {
      const problem = gstinProblem(gstin);
      if (problem) errors.gstin = problem;
      else if (draft.stateCode && gstin.slice(0, 2) !== draft.stateCode) {
        const gstState = states.find((s) => s.code === gstin.slice(0, 2))?.name ?? 'another state';
        const chosen = states.find((s) => s.code === draft.stateCode)?.name ?? 'another state';
        errors.gstin = `This GSTIN is for ${gstState}, but you chose ${chosen}. Pick the state on your GST registration.`;
      } else if (pan && pan !== gstin.slice(2, 12)) errors.pan = 'This PAN does not match the PAN inside your GSTIN.';
    }
    if (pan && !PAN_SHAPE.test(pan) && !errors.pan) errors.pan = 'Enter a 10-character PAN, like ABCDE1234F.';
  }
  return errors;
}

/** True when the business form has anything typed in it beyond its starting values. */
export const hasBusinessInput = (draft: BillingProfileDraft) =>
  Boolean(
    draft.legalName.trim() ||
    draft.gstin.trim() ||
    draft.pan.trim() ||
    draft.addressLine1.trim() ||
    draft.addressLine2.trim() ||
    draft.city.trim() ||
    draft.stateCode ||
    draft.postalCode.trim() ||
    draft.poReference.trim(),
  );

const PAISE_FORMAT = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 249900 -> "₹2,499.00" (Indian digit grouping, always two decimals). */
export const formatPaise = (paise: number) => `₹${PAISE_FORMAT.format((Number(paise) || 0) / 100)}`;

export type InvoiceListItem = {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  documentType: 'tax_invoice' | 'bill_of_supply';
  totalPaise: number;
  currency: string;
  buyerName: string;
  refunded: boolean;
  refundReference?: string | null;
};

export type InvoiceParty = {
  type?: string;
  name?: string;
  legalName?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  email?: string;
  poReference?: string;
};

export type InvoiceLine = {
  description: string;
  sacCode?: string;
  quantity?: number;
  taxableValuePaise: number;
  periodStart?: string | null;
  periodEnd?: string | null;
};

export type InvoiceDocumentData = {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  documentType: 'tax_invoice' | 'bill_of_supply' | 'booking_invoice';
  seller: InvoiceParty & { pending?: boolean; gstRegistered?: boolean };
  buyer: InvoiceParty;
  lineItems: InvoiceLine[];
  placeOfSupply?: { code: string; name: string } | null;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  ratePercent: number;
  amountInWords: string;
  paymentReference?: string;
  refund?: { status: string; reference?: string | null; at?: string | null } | null;
  sellerPendingBanner?: boolean;
  note?: string;
};

export const DOCUMENT_TITLE: Record<InvoiceDocumentData['documentType'], string> = {
  tax_invoice: 'Tax invoice',
  bill_of_supply: 'Bill of supply',
  booking_invoice: 'Invoice',
};

/** The file name a browser proposes when saving the print as PDF: "Invoice-VRS-2026-27-000123". */
export const invoiceFileTitle = (invoiceNumber: string) => `Invoice-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '-')}`;

/** Opens the print dialog with document.title set to the invoice file name, then restores it. */
export function printInvoice(invoiceNumber: string) {
  const previous = document.title;
  document.title = invoiceFileTitle(invoiceNumber);
  const restore = () => {
    document.title = previous;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  // Some browsers do not fire afterprint (or print is a no-op in automation): never leave the title changed.
  window.setTimeout(restore, 1500);
}

// --- Loading and saving the signed-in account's billing details ---

export type SaveResult =
  { ok: true; profile: BillingProfile } | { ok: false; errors: BillingProfileErrors; message: string };

/** The signed-in account's billing details, with a save that checks the form the way the API does. */
export function useBillingProfile() {
  const [data, setData] = useState<BillingProfileState | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await apiGet<BillingProfileState>('/billing/profile');
      if (next && Array.isArray(next.states)) setData(next);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (draft: BillingProfileDraft): Promise<SaveResult> => {
      const local = validateDraft(draft, data?.states ?? []);
      if (Object.keys(local).length)
        return { ok: false, errors: local, message: 'Check the highlighted billing details.' };
      try {
        const next = await apiPut<BillingProfileState>('/billing/profile', draft);
        setData((current) => (current ? { ...current, profile: next.profile } : next));
        return { ok: true, profile: next.profile as BillingProfile };
      } catch (e) {
        if (e instanceof ApiError && e.fields) {
          const errors: BillingProfileErrors = {};
          for (const [key, messages] of Object.entries(e.fields)) {
            if (messages[0]) (errors as Record<string, string>)[key] = messages[0];
          }
          if (Object.keys(errors).length)
            return { ok: false, errors, message: 'Check the highlighted billing details.' };
        }
        return {
          ok: false,
          errors: {},
          message: e instanceof Error ? e.message : 'We could not save your billing details. Try again.',
        };
      }
    },
    [data?.states],
  );

  return { data, failed, reload, save };
}

export type BillingProfileApi = ReturnType<typeof useBillingProfile>;
