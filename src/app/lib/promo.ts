import type { BillingInterval, BillingPromo, Plan, PromoValidation } from './apiTypes';

// Helpers shared by the pricing page, the billing page and their tests: price arithmetic that
// mirrors PlanPricing on the backend, the wording of a code's effect, and the code held in
// sessionStorage while a signed-out visitor signs in.

const CODE_KEY = 'verse_promo_code';

export const inr = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/** Price of one billing period, or null when the plan has none (Enterprise). */
export function periodPrice(plan: Plan, interval: BillingInterval): number | null {
  return interval === 'annual' ? (plan.annual ?? null) : plan.monthly;
}

/** The monthly equivalent of an annual price, rounded down: ₹24,990 a year is ₹2,082 a month. */
export const monthlyEquivalent = (annual: number) => Math.floor(annual / 12);

/** "₹24,990/yr · ₹2,082/mo · 2 months free" */
export function annualLine(annual: number) {
  return `${inr(annual)}/yr · ${inr(monthlyEquivalent(annual))}/mo · 2 months free`;
}

const unit = (interval: BillingInterval, count: number) =>
  interval === 'annual' ? (count === 1 ? 'year' : 'years') : count === 1 ? 'month' : 'months';

/** What a validated code does for `plan` on `interval`, in plain words; null when it does nothing. */
export function describeEffect(plan: Plan, interval: BillingInterval, result: PromoValidation): string | null {
  const { percentOff, durationPeriods, trialDays, earlyAccessDays } = result.effect;
  if (percentOff) {
    const base = periodPrice(plan, interval);
    if (base == null) return `${percentOff}% off`;
    const discounted = base * (1 - percentOff / 100);
    const per = interval === 'annual' ? 'year' : 'month';
    const span = durationPeriods ? ` for ${durationPeriods} ${unit(interval, durationPeriods)}` : '';
    return `${plan.name} at ${inr(discounted)}/${per}${span}`;
  }
  if (trialDays) return `${trialDays}-day free trial`;
  if (earlyAccessDays) return `Early Access Pro — free for ${earlyAccessDays} days`;
  return null;
}

/** "Code MUMBAI50 · 20% off for 2 more periods" for the billing page. */
export function describePromo(promo: BillingPromo): string {
  const head = `Code ${promo.code}`;
  if (promo.kind === 'extended_trial')
    return `${head} · ${promo.trialDays ? `${promo.trialDays}-day free trial` : 'extended free trial'}`;
  if (promo.kind === 'early_access') return `${head} · Early Access Pro`;
  const off = `${promo.percentOff ?? 0}% off`;
  if (promo.periodsLeft == null) return `${head} · ${off}`;
  if (promo.periodsLeft === 0) return `${head} · discount used up`;
  return `${head} · ${off} for ${promo.periodsLeft} more ${promo.periodsLeft === 1 ? 'period' : 'periods'}`;
}

export function normaliseCode(value: string) {
  return value.trim().toUpperCase().slice(0, 40);
}

export function storedCode(): string {
  try {
    return normaliseCode(sessionStorage.getItem(CODE_KEY) || '');
  } catch {
    return '';
  }
}

export function storeCode(code: string) {
  try {
    if (code) sessionStorage.setItem(CODE_KEY, code);
    else sessionStorage.removeItem(CODE_KEY);
  } catch {
    // Storage blocked: the code simply is not remembered across sign-in.
  }
}

export function referralShareText(code: string, shareUrl: string, percentOff = 20) {
  return `Join me on Verse — hirers get ${percentOff}% off with my code ${code}: ${shareUrl}`;
}

export function whatsappShareUrl(code: string, shareUrl: string, percentOff = 20) {
  return `https://wa.me/?text=${encodeURIComponent(referralShareText(code, shareUrl, percentOff))}`;
}
