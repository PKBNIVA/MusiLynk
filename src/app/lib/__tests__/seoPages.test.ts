import { describe, expect, it } from 'vitest';
import { hireHeading, hireLinkText, lower } from '../seoPages';

describe('seoPages wording', () => {
  it('keeps the DJ acronym and lowercases other roles', () => {
    expect(lower('DJ')).toBe('DJ');
    expect(lower('Drummer')).toBe('drummer');
  });

  it('builds headings with the right article', () => {
    expect(hireHeading('DJ', 'Pune')).toBe('Hire a verified DJ in Pune');
    expect(hireLinkText('Arranger', 'Mumbai')).toBe('Hire an arranger in Mumbai');
  });
});
