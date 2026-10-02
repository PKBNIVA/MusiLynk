import { afterEach, describe, expect, it } from 'vitest';
import type { Plan, PromoValidation } from '../apiTypes';
import {
  annualLine,
  describeEffect,
  describePromo,
  inr,
  monthlyEquivalent,
  normaliseCode,
  periodPrice,
  storeCode,
  storedCode,
  whatsappShareUrl,
} from '../promo';
import { blockStorage } from './helpers';

const pro: Plan = {
  code: 'pro',
  name: 'Pro',
  monthly: 2499,
  annual: 24990,
  trialDays: 14,
  activePosts: 10,
  seats: 2,
  shortlist: 250,
  bookings: 20,
};
const enterprise: Plan = { ...pro, code: 'enterprise', name: 'Enterprise', monthly: null, annual: null };
const empty = { percentOff: null, durationPeriods: null, trialDays: null, earlyAccessDays: null };
const result = (effect: Partial<PromoValidation['effect']>): PromoValidation => ({
  valid: true,
  kind: 'discount_percent',
  message: 'Code applied.',
  effect: { ...empty, ...effect },
});

afterEach(() => sessionStorage.clear());

describe('prices', () => {
  it('formats rupees and derives the annual line', () => {
    expect(inr(24990)).toBe('₹24,990');
    expect(monthlyEquivalent(24990)).toBe(2082);
    expect(annualLine(24990)).toBe('₹24,990/yr · ₹2,082/mo · 2 months free');
    expect(annualLine(59990)).toBe('₹59,990/yr · ₹4,999/mo · 2 months free');
  });

  it('picks the price for the interval', () => {
    expect(periodPrice(pro, 'monthly')).toBe(2499);
    expect(periodPrice(pro, 'annual')).toBe(24990);
    expect(periodPrice({ ...pro, annual: undefined }, 'annual')).toBeNull();
    expect(periodPrice(enterprise, 'monthly')).toBeNull();
  });
});

describe('describeEffect', () => {
  it('words a discount with its price and duration', () => {
    expect(describeEffect(pro, 'monthly', result({ percentOff: 20, durationPeriods: 3 }))).toBe(
      'Pro at ₹1,999/month for 3 months',
    );
    expect(describeEffect(pro, 'monthly', result({ percentOff: 20, durationPeriods: 1 }))).toBe(
      'Pro at ₹1,999/month for 1 month',
    );
    expect(describeEffect(pro, 'annual', result({ percentOff: 10, durationPeriods: 2 }))).toBe(
      'Pro at ₹22,491/year for 2 years',
    );
    expect(describeEffect(pro, 'annual', result({ percentOff: 10, durationPeriods: 1 }))).toBe(
      'Pro at ₹22,491/year for 1 year',
    );
    expect(describeEffect(pro, 'monthly', result({ percentOff: 50 }))).toBe('Pro at ₹1,250/month');
    expect(describeEffect(enterprise, 'monthly', result({ percentOff: 50 }))).toBe('50% off');
  });

  it('words trials, Early Access and nothing', () => {
    expect(describeEffect(pro, 'monthly', result({ trialDays: 90 }))).toBe('90-day free trial');
    expect(describeEffect(pro, 'monthly', result({ earlyAccessDays: 90 }))).toBe('Early Access Pro — free for 90 days');
    expect(describeEffect(pro, 'monthly', result({}))).toBeNull();
  });
});

describe('describePromo', () => {
  const base = { code: 'MUMBAI50', kind: 'discount_percent' as const, percentOff: 20, periodsLeft: 2, trialDays: null };
  it('shows the discount and the periods left', () => {
    expect(describePromo(base)).toBe('Code MUMBAI50 · 20% off for 2 more periods');
    expect(describePromo({ ...base, periodsLeft: 1 })).toBe('Code MUMBAI50 · 20% off for 1 more period');
    expect(describePromo({ ...base, periodsLeft: null })).toBe('Code MUMBAI50 · 20% off');
    expect(describePromo({ ...base, periodsLeft: 0 })).toBe('Code MUMBAI50 · discount used up');
    expect(describePromo({ ...base, kind: 'referral' })).toBe('Code MUMBAI50 · 20% off for 2 more periods');
  });

  it('shows trials and Early Access', () => {
    expect(describePromo({ ...base, kind: 'extended_trial', trialDays: 90 })).toBe('Code MUMBAI50 · 90-day free trial');
    expect(describePromo({ ...base, kind: 'extended_trial' })).toBe('Code MUMBAI50 · extended free trial');
    expect(describePromo({ ...base, kind: 'early_access' })).toBe('Code MUMBAI50 · Early Access Pro');
  });
});

describe('the code kept across sign-in', () => {
  it('normalises, stores and clears it', () => {
    expect(normaliseCode('  musilynk-abc123 ')).toBe('MUSILYNK-ABC123');
    expect(normaliseCode('x'.repeat(60))).toHaveLength(40);
    expect(storedCode()).toBe('');
    storeCode('MUMBAI50');
    expect(storedCode()).toBe('MUMBAI50');
    storeCode('');
    expect(storedCode()).toBe('');
  });

  it('survives blocked storage', () => {
    const restore = blockStorage('sessionStorage');
    try {
      expect(() => storeCode('MUMBAI50')).not.toThrow();
      expect(storedCode()).toBe('');
    } finally {
      restore();
    }
  });
});

describe('whatsappShareUrl', () => {
  it('builds the wa.me share text', () => {
    const url = whatsappShareUrl('MUSILYNK-ABCD1234', 'https://musilynk.example/pricing?code=MUSILYNK-ABCD1234');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1])).toBe(
      'Join me on MusiLynk — hirers get 20% off with my code MUSILYNK-ABCD1234: https://musilynk.example/pricing?code=MUSILYNK-ABCD1234',
    );
    expect(decodeURIComponent(whatsappShareUrl('C', 'u', 15).split('text=')[1])).toContain('15% off');
  });
});
