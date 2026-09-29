import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Billing from '../Billing';
import { apiGet, apiPost } from '../../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
vi.mock('../../lib/ai', () => ({ loadAiUsage: vi.fn().mockRejectedValue(new Error('no ai in test')) }));
vi.mock('../../lib/razorpayCheckout', () => ({ openRazorpayCheckout: vi.fn() }));
vi.mock('../../components/Navigation', () => ({ Navigation: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PLANS = [
  {
    code: 'free',
    name: 'Free',
    monthly: 0,
    annual: 0,
    trialDays: 0,
    activePosts: 1,
    seats: 1,
    shortlist: 20,
    bookings: 2,
  },
  {
    code: 'pro',
    name: 'Pro',
    monthly: 2499,
    annual: 24990,
    trialDays: 14,
    activePosts: 10,
    seats: 2,
    shortlist: 250,
    bookings: 20,
  },
];
const REFERRAL = {
  code: 'VERSE-MEERA2K7',
  shareUrl: 'https://verse.example/pricing?code=VERSE-MEERA2K7',
  redemptions: 3,
  rewardsEarned: 2,
  refereePercentOff: 20,
};
let summary: Record<string, unknown> | null;
let referral: unknown;
let annualAvailable: boolean;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  summary = null;
  referral = REFERRAL;
  annualAvailable = true;
  vi.mocked(apiGet).mockImplementation(async (path: string) => {
    if (path === '/billing/plans') return { plans: PLANS, annualAvailable };
    if (path === '/billing/subscription')
      return {
        subscription: null,
        plan: PLANS[0],
        purchasedPlan: PLANS[0],
        summary,
        history: [],
        testMode: false,
        paymentMode: 'live',
      };
    if (path === '/me/referral-code') {
      if (referral instanceof Error) throw referral;
      return referral;
    }
    throw new Error(`unexpected GET ${path}`);
  });
  vi.mocked(apiPost).mockResolvedValue({ checkout: { mode: 'mock' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function render(url = '/employer/billing') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Billing />
      </MemoryRouter>,
    );
  });
  await flush();
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

const activeAnnual = {
  status: 'active',
  planCode: 'pro',
  planName: 'Pro',
  provider: 'razorpay',
  interval: 'annual',
  amount: 24990,
  nextAmount: 19992,
  monthlyAmount: 2499,
  nextChargeAt: '2027-01-15T00:00:00Z',
  promo: { code: 'MUMBAI50', kind: 'discount_percent', percentOff: 20, periodsLeft: 2, trialDays: null },
};

describe('referral card', () => {
  it('shows the code, counters and a WhatsApp share link', async () => {
    await render();
    expect(byTestId('referral-code')?.textContent).toBe('VERSE-MEERA2K7');
    expect(byTestId('referral-redemptions')?.textContent).toBe('3');
    expect(byTestId('referral-rewards')?.textContent).toBe('2');
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('WhatsApp'))!;
    expect(link.href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(link.href.split('text=')[1])).toBe(
      'Join me on Verse — hirers get 20% off with my code VERSE-MEERA2K7: https://verse.example/pricing?code=VERSE-MEERA2K7',
    );
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('copies the code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await render();
    await act(async () => button('Copy').click());
    expect(writeText).toHaveBeenCalledWith('VERSE-MEERA2K7');
    expect(toast.success).toHaveBeenCalledWith('Referral code copied');
  });

  it('says so when copying is blocked', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await render();
    await act(async () => button('Copy').click());
    expect(toast.error).toHaveBeenCalledWith('Copy failed. Your code is VERSE-MEERA2K7.');
  });

  it('uses the programme percentage and defaults to 20', async () => {
    referral = { ...REFERRAL, refereePercentOff: undefined };
    await render();
    expect(byTestId('referral-card')?.textContent).toContain('get 20% off');
    referral = { ...REFERRAL, refereePercentOff: 15 };
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(byTestId('referral-card')?.textContent).toContain('get 15% off');
  });

  it('is absent when the programme is off or the request fails', async () => {
    referral = new Error('Referrals are turned off.');
    await render();
    expect(byTestId('referral-card')).toBeNull();
    expect(byTestId('plan-pro')).not.toBeNull();
  });

  it('ignores a malformed reply', async () => {
    referral = { nope: true };
    await render();
    expect(byTestId('referral-card')).toBeNull();
  });
});

describe('what the plan is paying', () => {
  it('names the active discount, the next amount and the yearly interval', async () => {
    summary = activeAnnual;
    await render();
    expect(byTestId('billing-promo')?.textContent).toBe('Code MUMBAI50 · 20% off for 2 more periods');
    expect(byTestId('billing-status-copy')?.textContent).toContain('Next charge: ₹19,992 for the year on');
  });

  it('names a trial code and an Early Access code', async () => {
    summary = {
      ...activeAnnual,
      status: 'trialing',
      interval: 'monthly',
      promo: { code: 'TRIAL90', kind: 'extended_trial', percentOff: null, periodsLeft: null, trialDays: 90 },
    };
    await render();
    expect(byTestId('billing-promo')?.textContent).toBe('Code TRIAL90 · 90-day free trial');
    expect(byTestId('billing-status-copy')?.textContent).toContain('first charge of ₹19,992 happens then');
  });

  it('has no code line for a plan bought without one', async () => {
    summary = { ...activeAnnual, promo: null };
    await render();
    expect(byTestId('billing-promo')).toBeNull();
  });
});

describe('choosing a plan', () => {
  it('sends the interval and the code carried from the pricing page', async () => {
    await render('/employer/billing?plan=pro&interval=annual&code=mumbai50');
    expect(byTestId('billing-code-note')?.textContent).toContain('MUMBAI50');
    expect(byTestId('plan-pro')?.textContent).toContain('₹24,990');
    expect(byTestId('plan-pro')?.textContent).toContain('₹24,990/yr · ₹2,082/mo · 2 months free');

    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(apiPost).toHaveBeenCalledWith(
      '/billing/checkout',
      { planCode: 'pro', interval: 'annual', code: 'MUMBAI50' },
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) }),
    );
  });

  it('defaults to monthly with no code, and follows the toggle', async () => {
    await render();
    expect(byTestId('billing-code-note')).toBeNull();
    expect(byTestId('plan-pro')?.textContent).toContain('₹2,499');
    await act(async () => button('Annual').click());
    expect(byTestId('plan-pro')?.textContent).toContain('₹24,990');
    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(vi.mocked(apiPost).mock.calls[0][1]).toEqual({ planCode: 'pro', interval: 'annual' });
  });

  it('hides the toggle and stays monthly when annual is not configured', async () => {
    annualAvailable = false;
    await render('/employer/billing?interval=annual');
    expect(byTestId('interval-toggle')).toBeNull();
    expect(byTestId('plan-pro')?.textContent).toContain('₹2,499');
    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(vi.mocked(apiPost).mock.calls[0][1]).toEqual({ planCode: 'pro', interval: 'monthly' });
  });

  it('uses the code kept across sign-in and forgets it after a successful checkout', async () => {
    sessionStorage.setItem('verse_promo_code', 'KEPT10');
    await render();
    expect(byTestId('billing-code-note')?.textContent).toContain('KEPT10');
    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(vi.mocked(apiPost).mock.calls[0][1]).toEqual({ planCode: 'pro', interval: 'monthly', code: 'KEPT10' });
    expect(sessionStorage.getItem('verse_promo_code')).toBeNull();
  });

  it('confirms an Early Access code without any payment step', async () => {
    vi.mocked(apiPost).mockResolvedValue({ checkout: { mode: 'early_access' } });
    await render('/employer/billing?code=EARLY');
    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(toast.success).toHaveBeenCalledWith('Early Access Pro is active. No card needed.');
  });

  it('shows the server reason when a code is refused at checkout', async () => {
    const { ApiError } = await import('../../lib/api');
    vi.mocked(apiPost).mockRejectedValue(new ApiError('This code has expired.', 422, 'PROMO_EXPIRED'));
    await render('/employer/billing?code=OLD');
    await act(async () => (byTestId('plan-pro')!.querySelector('button') as HTMLButtonElement).click());
    await flush();
    expect(toast.error).toHaveBeenCalledWith('This code has expired.');
  });
});
