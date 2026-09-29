import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodesTab, { effectText, previewCode } from '../CodesTab';
import { apiDownload, apiGet, apiPatch, apiPost } from '../../../lib/api';
import type { AdminPromoCode, AdminPromoProgramme } from '../../../lib/apiTypes';
import type { AdminActions, Confirm } from '../shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDownload: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Radix Select needs pointer-capture APIs jsdom lacks; a plain stand-in keeps these tests about the tab.
vi.mock('../ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui')>()),
  AdminSelect: ({
    id,
    value,
    onChange,
    options,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const PROGRAMME: AdminPromoProgramme = {
  referral: {
    enabled: true,
    refereePercentOff: 20,
    refereeDurationPeriods: 3,
    referrerRewardDays: 30,
    referrerRewardCap: 6,
    offerConfigured: false,
  },
  codeFormat: 'VERSE-{6}',
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  earlyAccess: { days: 90, seats: 50, granted: 12 },
  offerRequired: true,
  editNote: 'Referral programme settings are edited in backend/config/billing.yml.',
};
const code = (over: Partial<AdminPromoCode>): AdminPromoCode => ({
  id: 'prom_1',
  code: 'MUMBAI50',
  kind: 'discount_percent',
  percentOff: 20,
  durationPeriods: 2,
  trialDays: null,
  planCodes: ['pro'],
  intervals: [],
  razorpayOfferId: null,
  maxRedemptions: 100,
  redemptionsCount: 7,
  perUserLimit: 1,
  startsAt: null,
  expiresAt: null,
  active: true,
  ownerUserId: null,
  notes: 'Mumbai launch',
  batchId: null,
  needsOffer: false,
  createdAt: '2026-09-29T00:00:00Z',
  ...over,
});
const LIST = [
  code({ needsOffer: true }),
  code({
    id: 'prom_2',
    code: 'TRIAL90',
    kind: 'extended_trial',
    trialDays: 90,
    percentOff: null,
    durationPeriods: null,
    planCodes: [],
    maxRedemptions: null,
    notes: null,
  }),
  code({
    id: 'prom_3',
    code: 'EARLYX',
    kind: 'early_access',
    percentOff: null,
    durationPeriods: null,
    active: false,
    expiresAt: '2027-01-01T00:00:00Z',
    intervals: ['annual'],
  }),
  code({ id: 'prom_4', code: 'VERSE-MEERA2K7', kind: 'referral', percentOff: null, durationPeriods: null }),
];

let container: HTMLDivElement;
let root: Root;
let confirmSpy: ReturnType<typeof vi.fn>;
let actions: AdminActions;

beforeEach(() => {
  // Radix's checkbox measures itself with ResizeObserver, which jsdom does not provide.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path.includes('/redemptions')) {
      return {
        redemptions: [
          {
            id: 'r1',
            userId: 'u1',
            name: 'Asha Rao',
            email: 'asha@example.com',
            subscriptionId: 's1',
            kind: 'discount_percent',
            percentOff: 20,
            trialDays: null,
            redeemedAt: '2026-09-29T10:00:00Z',
            referrerReward: null,
          },
          {
            id: 'r2',
            userId: 'u2',
            name: null,
            email: null,
            subscriptionId: null,
            kind: 'referral',
            percentOff: 20,
            trialDays: null,
            redeemedAt: '2026-09-29T11:00:00Z',
            referrerReward: { days: 30, appliedAt: null, userId: 'u9' },
          },
        ],
      };
    }
    return { codes: LIST, programme: PROGRAMME, page: 1, perPage: 25, total: LIST.length };
  });
  vi.mocked(apiPost).mockResolvedValue({ code: LIST[0] });
  vi.mocked(apiPatch).mockResolvedValue({});
  confirmSpy = vi.fn();
  actions = {
    busy: null,
    act: vi.fn(async (_key: string, request: () => Promise<unknown>) => {
      await request();
    }),
    patch: vi.fn(),
    setConfirm: confirmSpy as unknown as (c: Confirm | null) => void,
    setGrant: vi.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function render() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await act(async () => {
    root.render(<CodesTab actions={actions} />);
  });
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  await flush();
}

const rows = () => Array.from(container.querySelectorAll('[data-testid="code-row"]'));
const btn = (scope: ParentNode, label: string) =>
  Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const fill = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const pick = async (el: HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('the codes table', () => {
  it('lists each code with its effect, scope, usage and state', async () => {
    await render();
    expect(rows()).toHaveLength(4);
    const first = rows()[0].textContent!;
    expect(first).toContain('MUMBAI50');
    expect(first).toContain('Discount');
    expect(first).toContain('20% off for 2 periods');
    expect(first).toContain('Pro · both');
    expect(first).toContain('7 / 100');
    expect(first).toContain('Never');
    expect(first).toContain('Active');
    const second = rows()[1].textContent!;
    expect(second).toContain('90-day free trial');
    expect(second).toContain('All plans');
    expect(second).not.toContain('/ ');
    const third = rows()[2].textContent!;
    expect(third).toContain('Early Access Pro · 90 days');
    expect(third).toContain('Annual');
    expect(third).toContain('Inactive');
    expect(rows()[3].textContent).toContain('20% off for 3 periods');
  });

  it('warns on a code live billing cannot honour', async () => {
    await render();
    expect(container.querySelectorAll('[data-testid="needs-offer"]')).toHaveLength(1);
    expect(rows()[0].querySelector('[data-testid="needs-offer"]')?.textContent).toContain('Needs a Razorpay offer id');
  });

  it('shows the referral programme read-only with the edit-in-config note', async () => {
    await render();
    const card = container.querySelector('[data-testid="referral-programme"]')!;
    expect(card.textContent).toContain('20% off for 3 billing periods');
    expect(card.textContent).toContain('30 free days per referral, up to 6 rewards');
    expect(card.textContent).toContain('billing.yml');
    expect(card.textContent).toContain('Razorpay offer not set');
    expect(card.querySelector('input')).toBeNull();
  });

  it('shows an empty state and a load error', async () => {
    vi.mocked(apiGet).mockResolvedValue({ codes: [], programme: PROGRAMME, page: 1, perPage: 25, total: 0 });
    await render();
    expect(container.textContent).toContain('No codes yet.');
    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(apiGet).mockRejectedValue(new Error('boom'));
    await render();
    expect(container.textContent).toContain('This panel could not load: boom');
  });

  it('refetches with the search and filters', async () => {
    await render();
    await fill(container.querySelector<HTMLInputElement>('#admin-code-search')!, 'mumbai');
    await pick(container.querySelector<HTMLSelectElement>('#admin-code-kind')!, 'extended_trial');
    await pick(container.querySelector<HTMLSelectElement>('#admin-code-active')!, 'true');
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await flush();
    const last = vi.mocked(apiGet).mock.calls.at(-1)![0];
    expect(last).toContain('/admin/promo-codes?');
    expect(last).toContain('q=mumbai');
    expect(last).toContain('kind=extended_trial');
    expect(last).toContain('active=true');
  });

  it('pages through long lists', async () => {
    vi.mocked(apiGet).mockResolvedValue({ codes: LIST, programme: PROGRAMME, page: 1, perPage: 2, total: 4 });
    await render();
    await act(async () => btn(container, 'Next').click());
    await flush();
    expect(vi.mocked(apiGet).mock.calls.at(-1)![0]).toContain('page=2');
  });
});

describe('deactivating', () => {
  it('asks for confirmation, then deactivates', async () => {
    await render();
    await act(async () => btn(rows()[0] as HTMLElement, 'Deactivate').click());
    const confirm = confirmSpy.mock.calls[0][0] as Confirm;
    expect(confirm.title).toBe('Deactivate MUMBAI50?');
    expect(confirm.destructive).toBe(true);
    expect(apiPatch).not.toHaveBeenCalled();
    await act(async () => {
      await confirm.run('');
    });
    expect(apiPatch).toHaveBeenCalledWith('/admin/promo-codes/prom_1', { active: false });
  });

  it('offers no deactivate for an inactive code', async () => {
    await render();
    expect(btn(rows()[2] as HTMLElement, 'Deactivate')).toBeUndefined();
  });
});

describe('creating a code', () => {
  async function open() {
    await render();
    await act(async () => btn(container, 'New code').click());
  }
  const input = (id: string) => dialog().querySelector<HTMLInputElement>(`#${id}`)!;

  it('creates a vanity discount code with only the discount fields', async () => {
    await open();
    expect(input('code-percent')).not.toBeNull();
    expect(input('code-offer')).not.toBeNull();
    expect(input('code-trial')).toBeNull();
    await fill(input('code-value'), 'summer25');
    await fill(input('code-percent'), '25');
    await fill(input('code-periods'), '3');
    await fill(input('code-offer'), ' offer_abc ');
    await fill(input('code-max'), '50');
    await fill(input('code-expires'), '2027-03-31');
    await fill(dialog().querySelector<HTMLTextAreaElement>('#code-notes')!, 'Summer run');
    await act(async () => (dialog().querySelector('[role="checkbox"]') as HTMLButtonElement).click());
    await act(async () => btn(dialog(), 'Create code').click());
    await flush();

    const [path, body] = vi.mocked(apiPost).mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/admin/promo-codes');
    expect(body).toMatchObject({
      kind: 'discount_percent',
      code: 'summer25',
      percentOff: 25,
      durationPeriods: 3,
      razorpayOfferId: 'offer_abc',
      maxRedemptions: 50,
      perUserLimit: 1,
      planCodes: ['pro'],
      intervals: [],
      notes: 'Summer run',
    });
    expect(typeof body.expiresAt).toBe('string');
    expect(body.generate).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('Code created');
    expect(dialog()).toBeNull();
  });

  it('shows the fields for an extended trial and the seat note for Early Access', async () => {
    await open();
    await pick(dialog().querySelector<HTMLSelectElement>('#code-kind')!, 'extended_trial');
    expect(input('code-trial')).not.toBeNull();
    expect(input('code-percent')).toBeNull();
    await fill(input('code-value'), 'TRIAL120');
    await fill(input('code-trial'), '120');
    await act(async () => btn(dialog(), 'Create code').click());
    await flush();
    expect(vi.mocked(apiPost).mock.calls[0][1]).toMatchObject({
      kind: 'extended_trial',
      trialDays: 120,
      code: 'TRIAL120',
    });

    await act(async () => btn(container, 'New code').click());
    await pick(dialog().querySelector<HTMLSelectElement>('#code-kind')!, 'early_access');
    expect(dialog().textContent).toContain('12 of 50 seats are taken');
    expect(input('code-percent')).toBeNull();
    expect(input('code-trial')).toBeNull();
  });

  it('generates a batch and previews the configured format', async () => {
    vi.mocked(apiPost).mockResolvedValue({ codes: [], batchId: 'batch-20260929-abc' });
    await open();
    await pick(dialog().querySelector<HTMLSelectElement>('#code-mode')!, 'batch');
    expect(input('code-value')).toBeNull();
    const preview = dialog().querySelector('[data-testid="format-preview"]')!.textContent!;
    expect(preview).toContain('Format VERSE-{6}');
    expect(preview).toMatch(/for example VERSE-[A-HJ-NP-Z2-9]{6}\./);
    await fill(input('code-generate'), '25');
    await act(async () => btn(dialog(), 'Generate codes').click());
    await flush();
    expect(vi.mocked(apiPost).mock.calls[0][1]).toMatchObject({ generate: 25, kind: 'discount_percent' });
    expect(vi.mocked(apiPost).mock.calls[0][1]).not.toHaveProperty('code');
    expect(toast.success).toHaveBeenCalledWith('25 codes generated');
    expect(toast.success).toHaveBeenCalledWith('Batch created. Use Export CSV for the codes.', expect.any(Object));
  });

  it('keeps the dialog open and shows the reason when the server refuses', async () => {
    const { ApiError } = await import('../../../lib/api');
    vi.mocked(apiPost).mockRejectedValue(new ApiError('Code has already been taken', 422, 'VALIDATION_FAILED'));
    await open();
    await fill(input('code-value'), 'DUPLICATE');
    await act(async () => btn(dialog(), 'Create code').click());
    await flush();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe('Code has already been taken');
    expect(btn(dialog(), 'Create code').disabled).toBe(false);
  });

  it('can be cancelled', async () => {
    await open();
    await act(async () => btn(dialog(), 'Cancel').click());
    expect(dialog()).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('redemptions drawer', () => {
  it('lists who used the code and the referrer reward', async () => {
    await render();
    await act(async () => btn(rows()[0] as HTMLElement, 'Redemptions').click());
    await flush();
    expect(vi.mocked(apiGet).mock.calls.at(-1)![0]).toBe('/admin/promo-codes/prom_1/redemptions?perPage=100');
    const items = Array.from(document.body.querySelectorAll('[data-testid="redemption-row"]'));
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Asha Rao');
    expect(items[0].textContent).toContain('asha@example.com');
    expect(items[1].textContent).toContain('u2');
    expect(items[1].textContent).toContain('Referrer earned 30 days (credit recorded, not yet applied)');
  });

  it('says when nobody has used it, and when it fails', async () => {
    vi.mocked(apiGet).mockImplementation(async (path: string) =>
      path.includes('/redemptions')
        ? { redemptions: [] }
        : { codes: LIST, programme: PROGRAMME, page: 1, perPage: 25, total: 4 },
    );
    await render();
    await act(async () => btn(rows()[0] as HTMLElement, 'Redemptions').click());
    await flush();
    expect(document.body.textContent).toContain('Nobody has used this code yet.');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path.includes('/redemptions')) throw new Error('nope');
      return { codes: LIST, programme: PROGRAMME, page: 1, perPage: 25, total: 4 };
    });
    await act(async () => btn(rows()[1] as HTMLElement, 'Redemptions').click());
    await flush();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('nope');
  });
});

describe('export', () => {
  it('downloads the CSV', async () => {
    vi.mocked(apiDownload).mockResolvedValue(new Blob(['code\n'], { type: 'text/csv' }));
    const create = vi.fn().mockReturnValue('blob:codes');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await render();
    await act(async () => btn(container, 'Export CSV').click());
    await flush();
    expect(apiDownload).toHaveBeenCalledWith('/admin/promo-codes/export.csv');
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(revoke).toHaveBeenCalledWith('blob:codes');
  });

  it('reports a failed export', async () => {
    vi.mocked(apiDownload).mockRejectedValue(new Error('no rows'));
    await render();
    await act(async () => btn(container, 'Export CSV').click());
    await flush();
    expect(toast.error).toHaveBeenCalledWith('no rows');
  });
});

describe('helpers', () => {
  it('words each kind and previews formats', () => {
    expect(effectText(code({ durationPeriods: null }))).toBe('20% off forever');
    expect(effectText(code({ kind: 'referral' }))).toBe('Referral discount');
    expect(effectText(code({ kind: 'early_access' }))).toBe('Early Access Pro');
    expect(previewCode('VERSE-{6}', 'ABCDEFGH')).toMatch(/^VERSE-[A-H]{6}$/);
    expect(previewCode('VERSE-{NAME4}{4}', 'ABCDEFGH')).toMatch(/^VERSE-[A-H]{8}$/);
  });
});
