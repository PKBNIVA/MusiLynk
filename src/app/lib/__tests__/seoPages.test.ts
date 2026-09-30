import { describe, expect, it } from 'vitest';
import { hireHeading, hireLinkText } from '../seoPages';

describe('seoPages wording', () => {
  it('builds headings with the right article', () => {
    expect(hireHeading('DJ', 'Pune')).toBe('Hire a verified DJ in Pune');
    expect(hireLinkText('Arranger', 'Mumbai')).toBe('Hire an arranger in Mumbai');
  });
});
