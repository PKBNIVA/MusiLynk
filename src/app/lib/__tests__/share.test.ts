import { describe, expect, it } from 'vitest';
import { shareCopy, shareLink, whatsappHref } from '../share';

describe('share helpers', () => {
  it('uses the given source and keeps existing query parameters', () => {
    const url = new URL(shareLink('/opportunities/1?ref=x', 'opportunity', 'copy'));
    expect(url.searchParams.get('ref')).toBe('x');
    expect(url.searchParams.get('utm_source')).toBe('copy');
    expect(url.searchParams.get('utm_campaign')).toBe('opportunity');
    expect(shareLink('https://other.test/p', 'act', 'native').startsWith('https://other.test/p?')).toBe(true);
  });

  it('builds professional copy for others and for the owner', () => {
    const long = 'N'.repeat(100);
    expect(shareCopy.professional('Asha', 'Sitarist', 'U', false)).toBe(
      'Check out Asha (Sitarist) on MusiLynk. Do have a look at the work and rates: U',
    );
    expect(shareCopy.professional('Asha', null, 'U', false)).not.toContain('(');
    expect(shareCopy.professional(long, undefined, 'U', false)).toContain(`${'N'.repeat(59)}…`);
    expect(shareCopy.professional('Asha', 'x', 'U', true)).toMatch(/^Here is my profile on MusiLynk/);
  });

  it('builds opportunity and hirer copy with optional company and place', () => {
    expect(shareCopy.opportunity('Drummer', 'Blue Note', 'Pune', 'U')).toBe(
      'Drummer at Blue Note, Pune. Interested musicians can apply on MusiLynk: U',
    );
    expect(shareCopy.opportunity('Drummer', null, null, 'U')).toBe(
      'Drummer. Interested musicians can apply on MusiLynk: U',
    );
    expect(shareCopy.hirerOpportunity('Keys', 'Goa', 'U')).toContain('Keys, Goa.');
    expect(shareCopy.hirerOpportunity('Keys', null, 'U')).toContain('Keys.');
    expect(shareCopy.act('The Night Owls', 'U')).toBe(
      'The Night Owls is on MusiLynk. See the lineup and request a quote: U',
    );
  });

  it('clips long titles with an ellipsis', () => {
    expect(shareCopy.act('A'.repeat(200), 'U')).toContain(`${'A'.repeat(79)}…`);
  });

  it('leaves the city out of the booking text when unknown', () => {
    expect(shareCopy.booking('Act', '1 Jan', null, 'U')).toBe(
      'Booking confirmed on MusiLynk: Act, 1 Jan. Sign in to see the details: U',
    );
  });

  it('tags the canonical link with utm params', () => {
    const url = new URL(shareLink('/professionals/abc', 'professional'));
    expect(url.pathname).toBe('/professionals/abc');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utm_source: 'whatsapp',
      utm_medium: 'share',
      utm_campaign: 'professional',
    });
  });

  it('encodes the message for wa.me', () => {
    const href = whatsappHref('Hello & welcome: https://x.test/?a=1');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1])).toBe('Hello & welcome: https://x.test/?a=1');
  });

  it('keeps the booking message free of money and contact details', () => {
    const text = shareCopy.booking('The Night Owls', '12 Nov 2026', 'Pune', 'https://verse.test/jobseeker/bookings');
    expect(text).toContain('Pune');
    expect(text).not.toMatch(/₹|fee|@|\d{10}/);
  });
});
