import { describe, expect, it } from 'vitest';
import { shareCopy, shareLink, whatsappHref } from '../share';

describe('share helpers', () => {
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
