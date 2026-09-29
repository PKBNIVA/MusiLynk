import { describe, expect, it } from 'vitest';
import { verifiedBadgeCopy } from '../VerifiedBadge';

describe('verifiedBadgeCopy', () => {
  it('falls back to a plain label when nothing was recorded', () => {
    expect(verifiedBadgeCopy(null)).toBe('Verified by Verse');
    expect(verifiedBadgeCopy(undefined)).toBe('Verified by Verse');
  });

  it('lists the checks and the month/year it was verified', () => {
    const copy = verifiedBadgeCopy({ checks: ['identity', 'work_links'], verifiedAt: '2026-03-15T00:00:00Z' });
    expect(copy).toBe('Verified by Verse: identity, work links · March 2026');
  });

  it('omits the date when verifiedAt is missing', () => {
    expect(verifiedBadgeCopy({ checks: ['credits'] })).toBe('Verified by Verse: credits');
  });
});
