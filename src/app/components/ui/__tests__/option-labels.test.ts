import { describe, expect, it } from 'vitest';
import { optionDescription, optionLabel } from '../option-labels';

describe('option labels', () => {
  it('maps stored values to human labels', () => {
    expect(optionLabel('onsite')).toBe('On-site');
    expect(optionLabel('session')).toBe('Studio session');
    expect(optionLabel('INR')).toBe('₹ · Indian rupee');
  });

  it('falls back to a readable version of unknown values', () => {
    expect(optionLabel('wedding-band')).toBe('Wedding band');
    expect(optionLabel('Music Production')).toBe('Music Production');
    expect(optionLabel('')).toBe('');
  });

  it('describes known values only', () => {
    expect(optionDescription('gig')).toBe('A one-off paid show or event');
    expect(optionDescription('Performance')).toBeUndefined();
  });
});
