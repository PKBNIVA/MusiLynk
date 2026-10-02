import { absoluteUrl } from '../components/PageMeta';

// Shared by ShareMenu and the pages that feed it: building the canonical, UTM-tagged link and the
// wa.me URL. Sharing always uses the canonical absolute URL (VITE_PUBLIC_URL) so WhatsApp's link
// preview crawler reaches the server-rendered share page with the OG image (see vercel.json).

export type ShareSurface =
  'professional' | 'opportunity' | 'act' | 'hirer_opportunity' | 'hirer_opportunity_posted' | 'booking' | 'referral';

export type ShareChannel = 'whatsapp' | 'copy' | 'native';

/** Canonical absolute URL for `path` with utm_source/utm_medium/utm_campaign appended. */
export function shareLink(path: string, surface: ShareSurface, source: 'whatsapp' | 'copy' | 'native' = 'whatsapp') {
  const url = new URL(absoluteUrl(path));
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', 'share');
  url.searchParams.set('utm_campaign', surface);
  return url.toString();
}

/** https://wa.me/?text=<encoded>: opens the WhatsApp app on mobile and WhatsApp Web on desktop. */
export function whatsappHref(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

export const shareCopy = {
  professional: (name: string, headline: string | null | undefined, url: string, own: boolean) =>
    own
      ? `Here is my profile on Verse. See my work and rates, and book or message me directly: ${url}`
      : `Check out ${clip(name, 60)}${headline ? ` (${clip(headline, 60)})` : ''} on Verse. Do have a look at the work and rates: ${url}`,
  opportunity: (title: string, company: string | null | undefined, place: string | null | undefined, url: string) =>
    `${clip(title, 80)}${company ? ` at ${clip(company, 50)}` : ''}${place ? `, ${clip(place, 40)}` : ''}. Interested musicians can apply on Verse: ${url}`,
  act: (name: string, url: string) => `${clip(name, 80)} is on Verse. See the lineup and request a quote: ${url}`,
  hirerOpportunity: (title: string, place: string | null | undefined, url: string) =>
    `We are hiring on Verse: ${clip(title, 80)}${place ? `, ${clip(place, 40)}` : ''}. Please apply, or forward this to musicians you know: ${url}`,
  // Deliberately no fee, phone number, email or street address: just enough for the other side
  // to recognise the booking, plus a link that needs a sign-in.
  booking: (act: string, date: string, city: string | null | undefined, url: string) =>
    `Booking confirmed on Verse: ${clip(act, 60)}, ${date}${city ? `, ${clip(city, 40)}` : ''}. Sign in to see the details: ${url}`,
};
