import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, apiGet: vi.fn(), apiPut: vi.fn() };
});
import { ApiError, apiGet, apiPut } from '../api';
import {
  draftFrom,
  emptyDraft,
  hasBusinessInput,
  normaliseGstin,
  useBillingProfile,
  type BillingProfile,
  type BillingProfileApi,
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

describe('drafts', () => {
  it('starts empty, individual by default, with account defaults', () => {
    const draft = emptyDraft();
    expect(draft.buyerType).toBe('individual');
    expect(draft.legalName).toBe('');
    expect(emptyDraft({ legalName: 'Asha', billingEmail: 'a@b.in' }).billingEmail).toBe('a@b.in');
  });

  it('copies only the editable fields from a saved profile', () => {
    const profile: BillingProfile = {
      ...business(),
      country: 'IN',
      state: 'Maharashtra',
      version: 3,
      gstin: '',
      pan: '',
      addressLine2: '',
      poReference: '',
    } as BillingProfile;
    const draft = draftFrom(profile);
    expect(draft).not.toHaveProperty('version');
    expect(draft).not.toHaveProperty('country');
    expect(draft.city).toBe('Mumbai');
  });

  it('knows when the business form has input', () => {
    expect(hasBusinessInput(emptyDraft())).toBe(false);
    expect(hasBusinessInput({ ...emptyDraft(), pan: 'X' })).toBe(true);
    expect(hasBusinessInput({ ...emptyDraft(), stateCode: '27' })).toBe(true);
    expect(hasBusinessInput({ ...emptyDraft(), poReference: 'PO1' })).toBe(true);
  });

  it('normalises GSTINs', () => {
    expect(normaliseGstin(' 27aapfu 0939f1zv ')).toBe('27AAPFU0939F1ZV');
  });
});

describe('validateDraft individuals and field rules', () => {
  const individual = (over: Record<string, string> = {}) => business({ buyerType: 'individual', ...over });

  it('ignores GSTIN and PAN for individuals', () => {
    expect(validateDraft(individual({ gstin: 'junk', pan: 'junk' }), states)).toEqual({});
  });
  it('checks name length, email, PO reference and spaced PIN codes', () => {
    expect(validateDraft(individual({ legalName: 'A' }), states).legalName).toMatch(/2 to 120/);
    expect(validateDraft(individual({ legalName: 'A'.repeat(121) }), states).legalName).toMatch(/2 to 120/);
    expect(validateDraft(individual({ billingEmail: 'nope' }), states).billingEmail).toMatch(/valid email/);
    expect(validateDraft(individual({ poReference: '#bad' }), states).poReference).toMatch(/letters, numbers/);
    expect(validateDraft(individual({ poReference: 'PO-12/A', postalCode: '400 050' }), states)).toEqual({});
    expect(validateDraft(individual({ postalCode: '040050' }), states).postalCode).toBeTruthy();
  });
  it('flags a malformed GSTIN and falls back to generic state names', () => {
    expect(validateDraft(business({ gstin: '27AAPFU' }), states).gstin).toMatch(/15-character/);
    const errors = validateDraft(business({ gstin: '27AAPFU0939F1ZV', stateCode: '99' }), states);
    expect(errors.stateCode).toBeTruthy();
    expect(errors.gstin).toMatch(/for Maharashtra, but you chose another state/);
    const unknown = validateDraft(business({ gstin: '24AAACC1206D1ZM' }), states);
    expect(unknown.gstin).toMatch(/for another state, but you chose Maharashtra/);
  });
  it('does not repeat the PAN format error when it already mismatches the GSTIN', () => {
    const errors = validateDraft(business({ gstin: '27AAPFU0939F1ZV', pan: 'BADPAN' }), states);
    expect(errors.pan).toMatch(/does not match/);
  });
});

describe('formatPaise edge cases', () => {
  it('treats bad numbers as zero', () => {
    expect(formatPaise(Number.NaN)).toBe('₹0.00');
    expect(formatPaise(5)).toBe('₹0.05');
  });
});

describe('useBillingProfile', () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;
  let hook: BillingProfileApi;
  const state = { profile: null, states, defaults: { legalName: 'A', billingEmail: 'a@b.in' } };

  function Harness() {
    hook = useBillingProfile();
    return null;
  }
  const mount = async () => {
    await act(async () => {
      root.render(<Harness />);
    });
  };

  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPut).mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));

  it('loads the profile state', async () => {
    vi.mocked(apiGet).mockResolvedValue(state);
    await mount();
    expect(hook.data).toEqual(state);
    expect(hook.failed).toBe(false);
  });

  it('marks failure on a bad payload or a request error', async () => {
    vi.mocked(apiGet).mockResolvedValue({ nope: true });
    await mount();
    expect(hook.failed).toBe(true);
    vi.mocked(apiGet).mockRejectedValue(new Error('down'));
    await act(async () => hook.reload());
    expect(hook.failed).toBe(true);
  });

  it('refuses to save an invalid draft without calling the API', async () => {
    vi.mocked(apiGet).mockResolvedValue(state);
    await mount();
    const result = await hook.save(emptyDraft());
    expect(result.ok).toBe(false);
    expect(apiPut).not.toHaveBeenCalled();
  });

  it('saves a valid draft and keeps the new profile', async () => {
    vi.mocked(apiGet).mockResolvedValue(state);
    await mount();
    const saved = { ...state, profile: { ...business(), country: 'IN' } };
    vi.mocked(apiPut).mockResolvedValue(saved);
    let result: Awaited<ReturnType<typeof hook.save>> | undefined;
    await act(async () => {
      result = await hook.save(business());
    });
    expect(result).toMatchObject({ ok: true });
    expect(hook.data?.profile).toEqual(saved.profile);
  });

  it('maps API field errors, falling back to the error message', async () => {
    vi.mocked(apiGet).mockResolvedValue(state);
    await mount();
    vi.mocked(apiPut).mockRejectedValueOnce(
      new ApiError('invalid', 422, undefined, undefined, { gstin: ['Taken'], pan: [] }),
    );
    let result = await hook.save(business());
    expect(result).toMatchObject({ ok: false, errors: { gstin: 'Taken' } });
    vi.mocked(apiPut).mockRejectedValueOnce(new ApiError('invalid', 422, undefined, undefined, { pan: [] }));
    result = await hook.save(business());
    expect(result).toMatchObject({ ok: false, errors: {}, message: 'invalid' });
    vi.mocked(apiPut).mockRejectedValueOnce('weird');
    result = await hook.save(business());
    expect(result).toMatchObject({ ok: false, message: 'We could not save your billing details. Try again.' });
  });

  it('sets state from the response when nothing had loaded yet', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('down'));
    await mount();
    expect(hook.data).toBeNull();
    // With no states loaded the local check fails first.
    const result = await hook.save(business());
    expect(result.ok).toBe(false);
  });
});
