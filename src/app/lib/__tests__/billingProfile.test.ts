import { describe, expect, it, vi } from 'vitest';
import {
  emptyDraft,
  formatPaise,
  gstinCheckCharacter,
  gstinProblem,
  invoiceFileTitle,
  printInvoice,
  validateDraft,
} from '../billingProfile';

const states = [
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
];
const business = (over: Record<string, string> = {}) => ({
  ...emptyDraft({ legalName: '', billingEmail: 'a@b.in' }, 'business'),
  legalName: 'Kapoor Events LLP',
  addressLine1: '12 Linking Road',
  city: 'Mumbai',
  stateCode: '27',
  postalCode: '400050',
  ...over,
});

describe('GSTIN checks (same rules as the API)', () => {
  it('accepts real GSTINs and computes their check characters', () => {
    for (const gstin of ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '24AAACC1206D1ZM']) {
      expect(gstinProblem(gstin)).toBe('');
      expect(gstinCheckCharacter(gstin.slice(0, 14))).toBe(gstin[14]);
    }
  });
  it('rejects a wrong check character and a bad shape', () => {
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/last character/);
    expect(gstinProblem('27AAPFU')).toMatch(/15-character/);
  });
});

describe('validateDraft', () => {
  it('passes a complete business with a matching GSTIN', () => {
    expect(validateDraft(business({ gstin: '27AAPFU0939F1ZV' }), states)).toEqual({});
  });
  it('lets a business omit GSTIN and PAN', () => {
    expect(validateDraft(business(), states)).toEqual({});
  });
  it('requires the GSTIN state to match the chosen state', () => {
    const errors = validateDraft(business({ gstin: '29AAGCB7383J1Z4' }), states);
    expect(errors.gstin).toMatch(/for Karnataka, but you chose Maharashtra/);
  });
  it('checks PAN format and PAN against the GSTIN', () => {
    expect(validateDraft(business({ pan: 'ABC' }), states).pan).toMatch(/10-character PAN/);
    expect(validateDraft(business({ gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' }), states).pan).toMatch(
      /does not match/,
    );
    expect(validateDraft(business({ gstin: '27AAPFU0939F1ZV', pan: 'aapfu0939f' }), states)).toEqual({});
  });
  it('explains missing address parts in plain words', () => {
    const errors = validateDraft(
      business({ legalName: '', addressLine1: '', city: '', stateCode: '', postalCode: '12' }),
      states,
    );
    expect(errors).toMatchObject({
      legalName: 'Enter the name to print on the invoice.',
      addressLine1: 'Enter the first line of your address.',
      city: 'Enter your city.',
      stateCode: 'Choose your state.',
      postalCode: 'Enter a 6-digit PIN code.',
    });
  });
});

describe('invoice helpers', () => {
  it('formats paise with Indian grouping', () => {
    expect(formatPaise(249900)).toBe('₹2,499.00');
    expect(formatPaise(12345650)).toBe('₹1,23,456.50');
  });
  it('names the PDF after the invoice number', () => {
    expect(invoiceFileTitle('VRS/2026-27/000123')).toBe('Invoice-VRS-2026-27-000123');
  });
  it('prints with the invoice title and puts the page title back', () => {
    document.title = 'Verse';
    let during = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      during = document.title;
    });
    printInvoice('VRS/2026-27/000123');
    expect(during).toBe('Invoice-VRS-2026-27-000123');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.title).toBe('Verse');
    print.mockRestore();
  });
});
