import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDeadline,
  formatFromRate,
  formatMoney,
  formatPay,
  formatReplyTime,
  formatWhen,
  fromRate,
  rateRows,
  toDate,
} from '../format';

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

describe('formatWhen', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const opts = { timeZone: 'UTC', now };
  it('says Today and Tomorrow with a short time', () => {
    expect(formatWhen('2026-09-28T18:00:00Z', opts)).toBe('Today 6 pm');
    expect(formatWhen('2026-09-29T18:30:00Z', opts)).toBe('Tomorrow 6:30 pm');
  });
  it('uses the weekday and date further out', () => {
    expect(formatWhen('2026-10-03T09:00:00Z', opts)).toBe('Sat 3 Oct 9 am');
  });
  it('falls back for empty values', () => {
    expect(formatWhen(null, { fallback: '-' })).toBe('-');
    expect(formatWhen('')).toBe('');
  });
});

describe('formatPay period', () => {
  it('drops a leading "per " from the period', async () => {
    const { formatPay } = await import('../format');
    expect(formatPay({ compensation_min: 15000, compensation_max: 25000, compensation_period: 'per project' })).toBe(
      '₹15,000–25,000 / project',
    );
  });
});

describe('rates', () => {
  it('fromRate is the lowest of session, show, day and hourly', () => {
    expect(fromRate({ sessionRate: 8000, showRate: 30000, dayRate: 15000 })).toBe(8000);
    expect(fromRate({ showRate: 30000, hourlyRate: 2500, tourDayRate: 500 })).toBe(2500);
  });

  it('ignores empty, zero and non-numeric rates', () => {
    expect(fromRate({})).toBeNull();
    expect(fromRate({ sessionRate: 0, showRate: null, dayRate: '' })).toBeNull();
    expect(fromRate({ tourDayRate: 9000 })).toBeNull();
    expect(fromRate({ sessionRate: 0, showRate: '12000' })).toBe(12000);
  });

  it('formats the from price with Indian grouping and blanks it when unknown', () => {
    expect(formatFromRate({ sessionRate: 5000 })).toBe('from ₹5,000');
    expect(formatFromRate({ dayRate: 125000 })).toBe('from ₹1,25,000');
    expect(formatFromRate({})).toBe('');
  });

  it('lists only the filled rate rows, in table order', () => {
    expect(rateRows({ hourlyRate: 1500, sessionRate: 5000, tourDayRate: 20000 })).toEqual([
      { label: 'Session', amount: '₹5,000' },
      { label: 'Tour day', amount: '₹20,000' },
      { label: 'Hourly', amount: '₹1,500' },
    ]);
    expect(rateRows({})).toEqual([]);
  });
});

describe('formatReplyTime', () => {
  it('reads minutes, then hours, and is empty when unknown', () => {
    expect(formatReplyTime(12)).toBe('Replies in ~12 min');
    expect(formatReplyTime(0)).toBe('Replies in ~1 min');
    expect(formatReplyTime(120)).toBe('Replies in ~2 h');
    expect(formatReplyTime(null)).toBe('');
    expect(formatReplyTime(undefined)).toBe('');
  });
});
