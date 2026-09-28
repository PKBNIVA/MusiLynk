import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDeadline, formatMoney, formatPay, toDate } from '../format';

const UTC = { timeZone: 'UTC' };

describe('toDate', () => {
  it('returns null for empty and invalid values', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate(new Date('nope'))).toBeNull();
  });

  it('reads a bare calendar date as local midnight', () => {
    const d = toDate('2026-12-15');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(11);
    expect(d?.getDate()).toBe(15);
    expect(d?.getHours()).toBe(0);
  });

  it('accepts ISO strings, epoch numbers and Date objects', () => {
    const iso = '2026-11-11T16:18:53.980Z';
    expect(toDate(iso)?.toISOString()).toBe(iso);
    expect(toDate(Date.parse(iso))?.toISOString()).toBe(iso);
    const d = new Date(iso);
    expect(toDate(d)).toBe(d);
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats in en-IN day-month-year order', () => {
    expect(formatDate('2026-11-11T16:18:53.980Z', UTC)).toBe('11 Nov 2026');
    expect(formatDate('2026-12-15')).toBe('15 Dec 2026');
  });

  it('includes the time for date-times', () => {
    expect(formatDateTime('2026-11-11T16:18:53.980Z', UTC)).toBe('11 Nov 2026, 4:18 pm');
  });

  it('respects the time zone', () => {
    expect(formatDate('2026-11-11T20:00:00Z', { timeZone: 'Asia/Kolkata' })).toBe('12 Nov 2026');
  });

  it('uses the fallback for missing or invalid values', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('garbage', { fallback: '—' })).toBe('—');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('', { fallback: 'n/a' })).toBe('n/a');
  });
});

describe('formatDeadline', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const opts = { ...UTC, now };

  it('shows the date and days remaining', () => {
    expect(formatDeadline('2026-12-15T12:00:00Z', opts)).toBe('Closes 15 Dec 2026 · in 78 days');
  });

  it('supports a different verb for detail pages', () => {
    expect(formatDeadline('2026-11-11T16:18:53.980Z', { ...opts, verb: 'Apply by' })).toBe(
      'Apply by 11 Nov 2026 · in 44 days',
    );
  });

  it('says today and tomorrow', () => {
    expect(formatDeadline('2026-09-28T23:00:00Z', opts)).toBe('Closes today');
    expect(formatDeadline('2026-09-29T01:00:00Z', opts)).toBe('Closes tomorrow');
  });

  it('marks past deadlines as closed', () => {
    expect(formatDeadline('2026-08-20T12:00:00Z', opts)).toBe('Closed 20 Aug 2026');
  });

  it('falls back when there is no deadline', () => {
    expect(formatDeadline(null)).toBe('Open until filled');
    expect(formatDeadline('', { fallback: 'No deadline' })).toBe('No deadline');
  });

  it('defaults "now" to the current time', () => {
    const inTen = new Date(Date.now() + 10 * 86_400_000);
    expect(formatDeadline(inTen)).toMatch(/^Closes .+ · in (9|10|11) days$/);
  });
});

describe('formatMoney', () => {
  it('uses Indian digit grouping and the rupee sign', () => {
    expect(formatMoney(150000)).toBe('₹1,50,000');
    expect(formatMoney('15000', 'inr')).toBe('₹15,000');
  });

  it('formats other currencies and unknown codes', () => {
    expect(formatMoney(1500, 'USD')).toBe('$1,500');
    expect(formatMoney(1500, 'ZZ')).toBe('ZZ 1,500');
    expect(formatMoney(1500, '')).toBe('₹1,500');
  });

  it('returns an empty string for missing or non-numeric values', () => {
    expect(formatMoney(null)).toBe('');
    expect(formatMoney(undefined)).toBe('');
    expect(formatMoney('')).toBe('');
    expect(formatMoney('abc')).toBe('');
  });
});

describe('formatPay', () => {
  it('prefers the free-text salary', () => {
    expect(formatPay({ salary: 'Revenue share', compensation_min: 1 })).toBe('Revenue share');
  });

  it('formats a range with the period', () => {
    expect(
      formatPay({ currency: 'INR', compensation_min: 15000, compensation_max: 35000, compensation_period: 'month' }),
    ).toBe('₹15,000–35,000 / month');
  });

  it('formats open-ended and single amounts', () => {
    expect(formatPay({ compensation_min: 15000 })).toBe('From ₹15,000');
    expect(formatPay({ compensation_max: '35000' })).toBe('Up to ₹35,000');
    expect(formatPay({ compensation_min: 5000, compensation_max: 5000, currency: 'USD' })).toBe('$5,000');
  });

  it('uses the fallback when nothing is disclosed', () => {
    expect(formatPay({})).toBe('Not disclosed');
    expect(formatPay({ compensation_min: null, compensation_max: '' }, 'Terms in listing')).toBe('Terms in listing');
  });
});
