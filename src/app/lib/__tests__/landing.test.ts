import { describe, expect, it } from 'vitest';
import { defaultUrgentStartAt, fromRateText, lowestRate, roleNoun, urgentPath } from '../landing';

describe('lowestRate / fromRateText', () => {
  it('takes the lowest filled-in rate', () => {
    expect(lowestRate({ sessionRate: 8000, showRate: 25000, dayRate: 5000 })).toBe(5000);
    expect(lowestRate({ hourlyRate: 1500, tourDayRate: 9000 })).toBe(1500);
  });
  it('ignores empty, zero and non-numeric rates', () => {
    expect(lowestRate({})).toBeNull();
    expect(lowestRate({ sessionRate: 0, showRate: null, dayRate: Number.NaN })).toBeNull();
    expect(lowestRate({ sessionRate: 0, dayRate: 7000 })).toBe(7000);
  });
  it('writes rupees the Indian way, or nothing', () => {
    expect(fromRateText({ sessionRate: 12000, dayRate: 15000 })).toBe('from ₹12,000');
    expect(fromRateText({ sessionRate: 5000, currency: 'INR' })).toBe('from ₹5,000');
    expect(fromRateText({ sessionRate: 100, currency: 'USD' })).toBe('from $100');
    expect(fromRateText({})).toBe('');
  });
});

describe('urgent prefill', () => {
  it('defaults to tomorrow at 6 pm local time', () => {
    const value = defaultUrgentStartAt(new Date(2026, 8, 30, 10, 15));
    expect(value).toBe('2026-10-01T18:00');
  });
  it('builds the /urgent link from the fields that are filled in', () => {
    expect(urgentPath({})).toBe('/urgent');
    expect(urgentPath({ role: ' ', city: '' })).toBe('/urgent');
    expect(urgentPath({ role: ' Drummer ', city: 'Mumbai', startAt: '2026-10-01T18:00' })).toBe(
      '/urgent?role=Drummer&city=Mumbai&startAt=2026-10-01T18%3A00',
    );
  });
});

describe('roleNoun', () => {
  it('keeps the DJ acronym and lowercases other roles', () => {
    expect(roleNoun('DJ')).toBe('DJ');
    expect(roleNoun('Drummer')).toBe('drummer');
  });
});
