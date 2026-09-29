import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { VerifiedBadge, verifiedBadgeCopy } from '../VerifiedBadge';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('verifiedBadgeCopy', () => {
  it('falls back to a plain label when nothing was recorded', () => {
    expect(verifiedBadgeCopy(null)).toBe('Verified by Verse');
    expect(verifiedBadgeCopy(undefined)).toBe('Verified by Verse');
  });

  it('lists the checks and the month/year it was verified', () => {
    const copy = verifiedBadgeCopy({ checks: ['identity', 'work_links'], verifiedAt: '2026-03-15T00:00:00Z' });
    expect(copy).toBe('Verified by Verse: identity, work links · Mar 2026');
  });

  it('omits the date when verifiedAt is missing', () => {
    expect(verifiedBadgeCopy({ checks: ['credits'] })).toBe('Verified by Verse: credits');
  });

  it('uses a short month, e.g. "Verified by Verse: identity, work links · Sep 2026"', () => {
    expect(verifiedBadgeCopy({ checks: ['identity', 'work_links'], verifiedAt: '2026-09-10T00:00:00Z' })).toBe(
      'Verified by Verse: identity, work links · Sep 2026',
    );
  });

  it('adds the Verified Pro line only for the pro tier', () => {
    const v = { checks: ['identity'], verifiedAt: '2026-09-10T00:00:00Z' };
    expect(verifiedBadgeCopy(v, 'verified')).toBe('Verified by Verse: identity · Sep 2026');
    expect(verifiedBadgeCopy(v, 'verified_pro')).toBe(
      'Verified Pro: 3+ completed jobs on Verse with reviews. Verified by Verse: identity · Sep 2026',
    );
  });
});

describe('VerifiedBadge', () => {
  const render = (tier?: 'verified' | 'verified_pro' | null) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<VerifiedBadge verification={{ checks: ['identity'] }} tier={tier} />));
    const badge = container.querySelector('[data-tier]');
    const result = { text: badge?.textContent, tier: badge?.getAttribute('data-tier') };
    act(() => root.unmount());
    container.remove();
    return result;
  };

  it('shows "Verified" by default and for the verified tier', () => {
    expect(render()).toEqual({ text: 'Verified', tier: 'verified' });
    expect(render('verified')).toEqual({ text: 'Verified', tier: 'verified' });
  });

  it('shows the "Verified Pro" variant for the pro tier', () => {
    expect(render('verified_pro')).toEqual({ text: 'Verified Pro', tier: 'verified_pro' });
  });
});
