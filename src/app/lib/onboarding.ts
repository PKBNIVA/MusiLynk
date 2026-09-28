import { apiPost } from './api';

// The two-minute sign-up: who you are, your work links, then an account. Shared by the
// musician and hirer flows on /join/*.

export const MAX_LINKS = 5;
export const DEFAULT_CITY = 'Mumbai';

/** The quick role picks for musicians and crew; anything else goes through the roles autocomplete. */
export const MUSICIAN_ROLES = [
  'Singer',
  'Guitarist',
  'Bassist',
  'Drummer',
  'Keyboard player',
  'Tabla player',
  'Percussionist',
  'Violinist',
  'DJ',
  'Music producer',
  'Sound engineer',
  'Live sound crew',
] as const;

export const HIRER_KINDS = [
  { value: 'studio', label: 'Recording studio', nameLabel: 'Studio name' },
  { value: 'event_company', label: 'Event or wedding company', nameLabel: 'Company name' },
  { value: 'band', label: 'Band or artist', nameLabel: 'Band or artist name' },
  { value: 'label', label: 'Music label', nameLabel: 'Label name' },
  { value: 'venue', label: 'Venue', nameLabel: 'Venue name' },
  { value: 'other', label: 'Something else', nameLabel: 'Company or team name' },
] as const;
export type HirerKind = (typeof HIRER_KINDS)[number]['value'];

export type LinkProvider = 'youtube' | 'soundcloud' | 'instagram' | 'spotify' | 'link';

export interface LinkPreview {
  provider: LinkProvider;
  kind: 'video' | 'audio' | 'link';
  label: string;
  url: string;
  title: string | null;
  author: string | null;
  thumbnail: string | null;
}

const PROVIDER_HOSTS: Record<Exclude<LinkProvider, 'link'>, string[]> = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
  soundcloud: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  spotify: ['open.spotify.com', 'spotify.link'],
};
export const PROVIDER_LABELS: Record<LinkProvider, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  spotify: 'Spotify',
  link: 'Link',
};

/**
 * A pasted link as the https URL the API accepts, or null when it isn't a web link.
 * "youtube.com/watch?v=1" and "http://…" become https, since every service we preview uses it.
 */
export function normalizeLink(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (/^http:\/\//i.test(value)) value = `https://${value.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value.replace(/^\/+/, '')}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function detectProvider(url: string): LinkProvider {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'link';
  }
  const found = (Object.keys(PROVIDER_HOSTS) as Array<keyof typeof PROVIDER_HOSTS>).find((provider) =>
    PROVIDER_HOSTS[provider].includes(host),
  );
  return found ?? 'link';
}

/** A preview built on this device, for when the preview service can't be reached. */
export function localPreview(url: string): LinkPreview {
  const provider = detectProvider(url);
  const kind = provider === 'youtube' || provider === 'instagram' ? 'video' : provider === 'link' ? 'link' : 'audio';
  return { provider, kind, label: PROVIDER_LABELS[provider], url, title: null, author: null, thumbnail: null };
}

export const fetchLinkPreview = (url: string) =>
  apiPost<LinkPreview>('/link-previews', { url }, { skipAuthRedirect: true, timeoutMs: 8_000 });

/** What a link card shows as its title. */
export function previewTitle(preview: LinkPreview) {
  if (preview.title) return preview.title;
  if (preview.provider !== 'link') return `${preview.label} ${preview.kind === 'audio' ? 'track' : 'post'}`;
  try {
    return new URL(preview.url).hostname.replace(/^www\./, '');
  } catch {
    return preview.url;
  }
}

/** The sign-up answers the API applies to a new account (see Onboarding::Starter). */
export interface StarterPayload {
  roles?: string[];
  city?: string;
  yearsExperience?: number;
  headline?: string;
  bio?: string;
  links?: Array<{ url: string; title?: string; thumbnail?: string }>;
  hirerKind?: HirerKind;
  companyName?: string;
}

export interface StarterResult {
  portfolioItems: number;
  organizationId: string | null;
}

/** Drops empty answers so "complete my profile later" sends nothing it doesn't have. */
export function compactStarter(starter: StarterPayload): StarterPayload {
  const out: StarterPayload = {};
  if (starter.roles?.length) out.roles = starter.roles;
  if (starter.city?.trim()) out.city = starter.city.trim();
  if (typeof starter.yearsExperience === 'number') out.yearsExperience = starter.yearsExperience;
  if (starter.headline?.trim()) out.headline = starter.headline.trim();
  if (starter.bio?.trim()) out.bio = starter.bio.trim();
  if (starter.links?.length) out.links = starter.links.slice(0, MAX_LINKS);
  if (starter.hirerKind) out.hirerKind = starter.hirerKind;
  if (starter.companyName?.trim()) out.companyName = starter.companyName.trim();
  return out;
}

export const hasStarter = (starter: StarterPayload) => Object.keys(compactStarter(starter)).length > 0;

/** Links as the API takes them: the preview's title and thumbnail only when it found them. */
export function starterLinks(previews: LinkPreview[]): StarterPayload['links'] {
  return previews.map((preview) => ({
    url: preview.url,
    ...(preview.title ? { title: preview.title } : {}),
    ...(preview.thumbnail ? { thumbnail: preview.thumbnail } : {}),
  }));
}
