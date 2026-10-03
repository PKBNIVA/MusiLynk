/**
 * The one place the public site's origin and per-page <head> wording live. Used by the pages
 * (usePageMeta), by the build-time pre-render (scripts/prerender-heads.mjs, which imports this file in
 * Node) and by the OG image function, so the HTML a crawler gets and the DOM after hydration agree.
 */

/** Where the public site lives when VITE_PUBLIC_URL is not set (previews then canonicalise to production). */
export const DEFAULT_PUBLIC_ORIGIN = 'https://musilynk.vercel.app';

/** The public origin, no trailing slash: VITE_PUBLIC_URL (Vite's env in the browser, process.env in Node). */
export function publicOrigin(): string {
  const fromVite = typeof import.meta.env !== 'undefined' ? import.meta.env?.VITE_PUBLIC_URL : undefined;
  const fromNode = typeof process !== 'undefined' ? process.env?.VITE_PUBLIC_URL : undefined;
  return String(fromVite || fromNode || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, '');
}

/** An absolute URL on this site for a path ("/hire/dj/mumbai"); structured data and canonicals need full URLs. */
export function absoluteUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${publicOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The document title for a page title: suffixed with the site name unless it already names it. */
export function documentTitle(title: string, site: string): string {
  return title.includes(site) ? title : `${title} · ${site}`;
}

/** Meta descriptions are cut at 160 characters, the same way everywhere. */
export function clipDescription(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
}

export type PageMetaEntry = { title: string; description: string };

/** Title and description of each static public page, keyed by path. Pages read theirs from here. */
export const PUBLIC_PAGE_META: Record<string, PageMetaEntry> = {
  '/': {
    title: 'Hire verified musicians in Mumbai within 24 hours',
    description:
      'Hire verified singers, session players, DJs and sound crew in Mumbai for recording sessions, weddings and gigs, within 24 hours. Musicians join free.',
  },
  '/music-jobs': {
    title: 'Music jobs, gigs, sessions & auditions',
    description:
      'Browse open music jobs, gigs, studio sessions, auditions and tours across performance, production and live events.',
  },
  '/music-professionals': {
    title: 'Find musicians',
    description:
      'Search singers, instrumentalists, composers, engineers, technical directors, tour crew and managers on MusiLynk.',
  },
  '/book-music': {
    title: 'Book singers, bands & live acts',
    description:
      'Discover bookable singers, duos, bands and ensembles, compare lineups and request a quote for your event on MusiLynk.',
  },
  '/urgent': {
    title: 'Need someone by tomorrow?',
    description:
      'Post an urgent music hiring request and get matched with available, verified musicians and crew near you within hours.',
  },
  '/join/hiring': {
    title: 'Join to hire musicians and crew',
    description:
      'Studios, event and wedding companies, bands, labels and venues: create a free account in a minute and find a verified musician in Mumbai within 24 hours.',
  },
  '/join/musician': {
    title: 'Join as a musician or crew',
    description:
      'Create a verified music portfolio in two minutes: pick your role, paste links to your YouTube, Instagram, SoundCloud or Spotify work, and get booked in Mumbai.',
  },
  '/pricing': {
    title: 'Pricing',
    description:
      'MusiLynk plans for music hiring and booking teams. Musicians build profiles and apply free; paid plans add capacity, seats and trials.',
  },
  '/guide': {
    title: 'How to use MusiLynk',
    description: 'Step-by-step guides for musicians, hirers, bands and event bookers on MusiLynk.',
  },
  '/about': {
    title: 'About MusiLynk',
    description:
      'MusiLynk connects musicians, bands and hiring teams for gigs, sessions and live bookings across India.',
  },
  '/safety': {
    title: 'Trust & Safety',
    description: 'How MusiLynk verifies professionals, protects payments and keeps the marketplace safe.',
  },
  '/credits': {
    title: 'Photo credits',
    description:
      'The photographers and licences behind the pictures on MusiLynk, from Wikimedia Commons under Creative Commons and public-domain terms.',
  },
  '/contact': { title: 'Contact MusiLynk', description: 'Get in touch with the MusiLynk team.' },
  '/community-guidelines': {
    title: 'Community guidelines',
    description: 'The standards MusiLynk expects from every musician, band and hiring team on the platform.',
  },
  '/terms': { title: 'Terms of service', description: "MusiLynk's terms of service." },
  '/privacy': { title: 'Privacy policy', description: "MusiLynk's privacy policy." },
};
