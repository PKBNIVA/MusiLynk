import { describe, expect, it } from 'vitest';
import { formatAge, formatP95, formatRate } from '../OperationsPanel';

const window = { requests: 10, serverErrors: 0, serverErrorRate: 0 };

describe('operations panel formatting', () => {
  it('shows p95 as the upper edge of its bucket, or above the largest bucket', () => {
    expect(formatP95({ ...window, p95Ms: 250, p95OverMs: null })).toBe('≤ 250 ms');
    expect(formatP95({ ...window, p95Ms: 1500, p95OverMs: null })).toBe('≤ 1.5 s');
    expect(formatP95({ ...window, p95Ms: null, p95OverMs: 10000 })).toBe('> 10 s');
    expect(formatP95({ ...window, p95Ms: null, p95OverMs: null })).toBe('—');
  });

  it('shows error rates as percentages and keeps tiny rates visible', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0)).toBe('0.0%');
    expect(formatRate(0.0125)).toBe('1.3%');
    expect(formatRate(0.0004)).toBe('0.04%');
  });

  it('shows queue age in the largest sensible unit', () => {
    expect(formatAge(null)).toBe('None waiting');
    expect(formatAge(42)).toBe('42 s');
    expect(formatAge(600)).toBe('10 min');
    expect(formatAge(5400)).toBe('1.5 h');
  });
});
