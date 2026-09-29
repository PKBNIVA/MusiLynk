import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pricing from '../Pricing';
import { ApiError, apiGet, apiPost } from '../../lib/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

// PublicNav lazy-loads the identity switcher, which needs the auth provider this page test omits.
vi.mock('../../components/showcase/IdentitySwitcher', () => ({ IdentitySwitcher: () => null }));

// PublicNav reads the session; this test is about the page copy, so present a signed-out visitor.
vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({ status: 'signedOut', user: null, loading: false, isAuthenticated: false, logout: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

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
  {
    code: 'studio',
    name: 'Studio',
    monthly: 5999,
    annual: 59990,
    trialDays: 14,
    activePosts: 50,
    seats: 8,
    shortlist: 2000,
    bookings: 100,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    monthly: null,
    annual: null,
    trialDays: 0,
    activePosts: 9999,
    seats: 999,
    shortlist: 99999,
    bookings: 9999,
  },
];
type Effect = {
  percentOff: number | null;
  durationPeriods: number | null;
  trialDays: number | null;
  earlyAccessDays: number | null;
};
const EMPTY: Effect = { percentOff: null, durationPeriods: null, trialDays: null, earlyAccessDays: null };
const good = (effect: Partial<Effect>, kind = 'discount_percent') => ({
  valid: true,
  kind,
  message: 'Code applied.',
  effect: { ...EMPTY, ...effect },
});
const bad = (message: string) => ({ valid: false, reason: 'expired', kind: null, message, effect: EMPTY });

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(apiGet).mockResolvedValue({ plans: PLANS, annualAvailable: true });
  vi.mocked(apiPost).mockResolvedValue(bad('That code isn’t valid.'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function Landed() {
  const location = useLocation();
  return <div data-testid="landed">{JSON.stringify(location.state)}</div>;
}

async function render(url = '/pricing') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/auth/employer" element={<Landed />} />
        </Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  await flush();
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

const plansText = () => container.querySelector('[data-testid="pricing-plans"]')?.textContent || '';
const result = () => container.querySelector('[data-testid="promo-result"]')?.textContent || '';
const input = () => container.querySelector<HTMLInputElement>('#promo-code')!;
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

async function typeCode(value: string, how: 'blur' | 'enter' = 'blur') {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    if (how === 'enter') input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    else input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await flush();
}

describe('Pricing page copy (V-flat-fee-note)', () => {
  it('renders the flat-fee and cancel-anytime copy below the plan cards', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('offline in test'));
    await render();

    const note = container.querySelector('[data-testid="flat-fee-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain(
      'One flat fee. No commission on your bookings. A ₹5 lakh wedding band booked through a commission agency costs ₹75,000–₹1,00,000 in fees; on Verse it costs your monthly plan.',
    );
    expect(note?.textContent).toContain(
      'Cancel any time. We email you three days before your trial ends and before every renewal.',
    );

    // Plan prices/limits/CTAs are untouched.
    expect(plansText()).toContain('₹2,499');
    // With the API unreachable there is no way to know annual works, so the toggle stays hidden.
    expect(container.querySelector('[data-testid="interval-toggle"]')).toBeNull();
  });
});

describe('monthly / annual toggle', () => {
  it('shows the toggle when annual is available and switches every paid card to yearly prices', async () => {
    await render();
    expect(container.querySelector('[data-testid="interval-toggle"]')).not.toBeNull();
    expect(plansText()).toContain('₹2,499');
    expect(plansText()).not.toContain('2 months free');

    await act(async () => button('Annual').click());
    expect(plansText()).toContain('₹24,990');
    expect(plansText()).toContain('/ year');
    expect(container.querySelector('[data-testid="annual-line-pro"]')?.textContent).toBe(
      '₹24,990/yr · ₹2,082/mo · 2 months free',
    );
    expect(container.querySelector('[data-testid="annual-line-studio"]')?.textContent).toBe(
      '₹59,990/yr · ₹4,999/mo · 2 months free',
    );
    expect(container.querySelector('[data-testid="annual-line-free"]')).toBeNull();
    expect(plansText()).toContain('Free');

    await act(async () => button('Monthly').click());
    expect(plansText()).toContain('₹5,999');
    expect(container.querySelector('[data-testid="annual-line-pro"]')).toBeNull();
    expect(container.querySelector('[data-testid="flat-fee-note"]')).not.toBeNull();
  });

  it('hides the toggle when the API says annual billing is not configured, even if ?interval=annual', async () => {
    vi.mocked(apiGet).mockResolvedValue({ plans: PLANS, annualAvailable: false });
    await render('/pricing?interval=annual');
    expect(container.querySelector('[data-testid="interval-toggle"]')).toBeNull();
    expect(plansText()).toContain('₹2,499');
    expect(plansText()).not.toContain('₹24,990');
  });

  it('opens on annual with ?interval=annual and the call to action carries interval, plan and code', async () => {
    await render('/pricing?interval=annual');
    expect(plansText()).toContain('₹24,990');
    const links = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent === 'Start free trial');
    await act(async () => links[0].click());
    expect(JSON.parse(container.querySelector('[data-testid="landed"]')!.textContent!)).toEqual({
      from: '/employer/billing?plan=pro&interval=annual',
    });
  });
});

describe('"Have a code?"', () => {
  it('starts collapsed and opens an inline field', async () => {
    await render();
    expect(input()).toBeNull();
    await act(async () => button('Have a code?').click());
    expect(input()).not.toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('validates on blur against each paid plan and words the effect', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ percentOff: 20, durationPeriods: 3 }));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('mumbai50');

    expect(apiPost).toHaveBeenCalledWith(
      '/billing/codes/validate',
      { code: 'MUMBAI50', planCode: 'pro', interval: 'monthly' },
      { skipAuthRedirect: true },
    );
    expect(apiPost).toHaveBeenCalledWith(
      '/billing/codes/validate',
      { code: 'MUMBAI50', planCode: 'studio', interval: 'monthly' },
      { skipAuthRedirect: true },
    );
    expect(result()).toContain('Pro at ₹1,999/month for 3 months');
    expect(result()).toContain('Studio at ₹4,799/month for 3 months');
    expect(sessionStorage.getItem('verse_promo_code')).toBe('MUMBAI50');
  });

  it('validates on Enter, and the call to action then carries the code', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ trialDays: 90 }, 'extended_trial'));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('TRIAL90', 'enter');
    expect(result()).toContain('90-day free trial');

    const links = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent === 'Start free trial');
    await act(async () => links[1].click());
    expect(JSON.parse(container.querySelector('[data-testid="landed"]')!.textContent!)).toEqual({
      from: '/employer/billing?plan=studio&interval=monthly&code=TRIAL90',
    });
  });

  it('describes an Early Access code', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ earlyAccessDays: 90 }, 'early_access'));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('EARLY');
    expect(result()).toContain('Early Access Pro — free for 90 days');
  });

  it('shows the reason for a code that cannot be used and carries nothing', async () => {
    vi.mocked(apiPost).mockResolvedValue(bad('This code has expired.'));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('OLD');
    expect(result()).toBe('This code has expired.');
    expect(sessionStorage.getItem('verse_promo_code')).toBeNull();
    const links = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent === 'Start free trial');
    await act(async () => links[0].click());
    expect(container.querySelector('[data-testid="landed"]')!.textContent).not.toContain('code=');
  });

  it('shows a plan restriction next to the plan the code does work for', async () => {
    vi.mocked(apiPost).mockImplementation(async (_path, body) => {
      const { planCode } = body as { planCode: string };
      return planCode === 'studio' ? good({ percentOff: 10 }) : bad('This code is for the Studio plan.');
    });
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('STUDIOONLY');
    expect(result()).toContain('This code is for the Studio plan.');
    expect(result()).toContain('Studio at ₹5,399/month');
  });

  it('keeps the code for after sign-in when signed out', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError('Authentication required', 401));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('MUMBAI50');
    expect(result()).toContain("Sign in and we'll check this code");
    expect(sessionStorage.getItem('verse_promo_code')).toBe('MUMBAI50');
  });

  it('reports a failed check without keeping the code', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError('Too many requests', 429));
    await render();
    await act(async () => button('Have a code?').click());
    await typeCode('MUMBAI50');
    expect(result()).toContain('Too many requests');
  });

  it('prefills from ?code= and validates it, again when the interval changes', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ percentOff: 20, durationPeriods: 3 }));
    await render('/pricing?code=verse-abc123');
    expect(input().value).toBe('VERSE-ABC123');
    expect(apiPost).toHaveBeenCalledWith(
      '/billing/codes/validate',
      { code: 'VERSE-ABC123', planCode: 'pro', interval: 'monthly' },
      { skipAuthRedirect: true },
    );
    expect(result()).toContain('Pro at ₹1,999/month for 3 months');

    await act(async () => button('Annual').click());
    await flush();
    expect(apiPost).toHaveBeenCalledWith(
      '/billing/codes/validate',
      { code: 'VERSE-ABC123', planCode: 'pro', interval: 'annual' },
      { skipAuthRedirect: true },
    );
    expect(result()).toContain('Pro at ₹19,992/year for 3 years');
  });

  it('picks up the code kept before sign-in', async () => {
    sessionStorage.setItem('verse_promo_code', 'KEPT10');
    vi.mocked(apiPost).mockResolvedValue(good({ percentOff: 10 }));
    await render();
    expect(input().value).toBe('KEPT10');
    expect(result()).toContain('Pro at ₹2,249/month');
  });

  it('clearing the field forgets the code', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ percentOff: 10 }));
    await render('/pricing?code=KEEP');
    expect(sessionStorage.getItem('verse_promo_code')).toBe('KEEP');
    await typeCode('');
    expect(sessionStorage.getItem('verse_promo_code')).toBeNull();
    expect(result()).toBe('');
  });

  it('does not re-check an unchanged code on blur', async () => {
    vi.mocked(apiPost).mockResolvedValue(good({ percentOff: 10 }));
    await render('/pricing?code=SAME');
    const calls = vi.mocked(apiPost).mock.calls.length;
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(vi.mocked(apiPost).mock.calls.length).toBe(calls);
  });
});
