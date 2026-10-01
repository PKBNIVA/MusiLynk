// NOT DEPLOYED YET. Vercel rejected this file as an edge function at deploy time ("The Edge Function
// api/og is referencing unsupported modules: @vercel: module": the builder ships it unbundled, with the
// dynamic import of @vercel/og left as a bare specifier), and a rejected function fails the whole site
// deploy. It lives outside api/ until it is rebuilt as a bundled function; meanwhile vercel.json answers
// /api/og/:type/:id with the static /og-default.png so every share link still has a valid image.
// Open Graph image for a share link: GET /api/og/<type>/<id>.png (type = professional | opportunity | act),
// served by the Vercel function api/og/[type]/[id].ts. This module is the part that needs no renderer: it
// draws a 1200x630 card from the same public JSON the site itself reads (avatar or generated art, name,
// role, city, "from ₹", Verified) and falls back to a default brand card for an unknown id, a failed
// lookup or no id at all. The share pages (backend/app/controllers/share_pages_controller.rb) point og:image
// at the route. The leading underscore keeps Vercel from deploying this file as a function of its own.
//
// The card is described as plain { type, props } elements (no JSX, no React) so there is no build step.
// Everything that can be checked without the renderer is exported and unit-tested
// (scripts/__tests__/og.test.mjs); the renderer, the network and the clock are passed in. The renderer
// itself (@vercel/og, a static import) lives only in the function file.
import { blobs, gradientAngle, paletteFor, ribbonBars, type Palette } from '../../src/app/lib/coverArt.js';
import { initialsOf } from '../../src/app/lib/avatar.js';

export const CARD_TYPES = ['professional', 'opportunity', 'act'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Where the public JSON comes from. OG_API_ORIGIN overrides it (a preview API, a local Rails). */
export const DEFAULT_API_ORIGIN = 'https://verse-music-platform-production.up.railway.app';

export const SIZE = { width: 1200, height: 630 } as const;

const CACHE_OK = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_FALLBACK = 'public, max-age=300, s-maxage=300';

/** What a card says, before it is drawn. */
export interface Card {
  kicker: string;
  title: string;
  subtitle: string;
  chips: string[];
  /** Seed for the generated art; the same id always draws the same picture. */
  seed: string;
  kind?: string;
  genres: string[];
  monogram: string;
  /** A photo a person uploaded (never for a demo account, never a stock face). */
  photoUrl?: string;
  /** Circle for a person, rounded square for an opportunity or act. */
  shape: 'circle' | 'square';
}

type Json = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : []);
const num = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

export const clip = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** "₹5,000" (Indian digit grouping); other currencies keep their code. */
export function money(amount: number, currency = 'INR'): string {
  const grouped = Math.round(amount).toLocaleString('en-IN');
  return !currency || currency.toUpperCase() === 'INR' ? `₹${grouped}` : `${currency.toUpperCase()} ${grouped}`;
}

/** The lowest rate a person has filled in (session, show, day, tour day, hourly), or null. */
export function lowestRate(profile: Json): number | null {
  const rates = ['sessionRate', 'showRate', 'dayRate', 'tourDayRate', 'hourlyRate']
    .map((key) => num(profile[key]))
    .filter((rate): rate is number => rate !== null);
  return rates.length ? Math.min(...rates) : null;
}

/** A photo URL worth fetching: https only. Anything else falls back to the generated art. */
export function safePhotoUrl(value: unknown): string | undefined {
  const url = str(value);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : undefined;
}

export function professionalCard(id: string, person: Json): Card | null {
  const name = str(person.name);
  if (!name) return null;
  const roles = list(person.roles);
  const genres = list(person.genres);
  const demo = person.demo === true;
  const rate = lowestRate(person);
  const tier = str(person.verificationTier);
  const chips = [
    person.verified === true ? (tier === 'verified_pro' ? 'Verified Pro' : 'Verified') : '',
    rate === null ? '' : `from ${money(rate, str(person.currency) || 'INR')}`,
    ...genres.slice(0, 2),
  ].filter(Boolean);
  const location = str(person.location);
  return {
    kicker: clip(['Musician', location].filter(Boolean).join(' · '), 48),
    title: clip(name, 48),
    subtitle: clip(str(person.headline) || roles.join(', ') || 'Music professional on Verse', 90),
    chips: chips.slice(0, 3),
    seed: id,
    genres: [...genres, ...roles],
    monogram: initialsOf(name),
    photoUrl: demo ? undefined : safePhotoUrl(person.photoUrl),
    shape: 'circle',
  };
}

export function opportunityCard(id: string, job: Json): Card | null {
  const title = str(job.title);
  if (!title) return null;
  const currency = str(job.currency) || 'INR';
  const low = num(job.compensation_min);
  const high = num(job.compensation_max);
  const pay =
    str(job.salary) ||
    (low && high && high !== low
      ? `${money(low, currency)}–${money(high, currency).replace(/^[^\d]*/, '')}`
      : low || high
        ? `from ${money((low ?? high) as number, currency)}`
        : '');
  const kind = str(job.type) || str(job.kind);
  const company = str(job.company) || str(job.employerName);
  return {
    kicker: clip(['Opportunity', kind].filter(Boolean).join(' · '), 48),
    title: clip(title, 70),
    subtitle: clip(company || 'Hiring on Verse', 90),
    chips: [str(job.location), pay, job.employerVerified === true ? 'Verified hirer' : ''].filter(Boolean).slice(0, 3),
    seed: id,
    kind,
    genres: list(job.genres).concat(str(job.genre) ? [str(job.genre)] : []),
    monogram: initialsOf(company || title),
    shape: 'square',
  };
}

export function actCard(id: string, act: Json): Card | null {
  const name = str(act.name);
  if (!name) return null;
  const genres = list(act.genres);
  const fee = num(act.min_fee);
  const lineup = num(act.lineup_size);
  const demo = act.demo === true;
  const chips = [
    act.verified === true || act.ownerVerified === true ? 'Verified' : '',
    fee === null ? '' : `from ${money(fee, str(act.currency) || 'INR')}`,
    lineup && lineup > 1 ? `${lineup} on stage` : '',
    ...genres.slice(0, 2),
  ].filter(Boolean);
  return {
    kicker: clip(['Live act', str(act.city)].filter(Boolean).join(' · '), 48),
    title: clip(name, 48),
    subtitle: clip(str(act.tagline) || str(act.act_type) || 'Bookable on Verse', 90),
    chips: chips.slice(0, 3),
    seed: id,
    kind: str(act.act_type),
    genres,
    monogram: initialsOf(name),
    photoUrl: demo ? undefined : safePhotoUrl(act.photo_url),
    shape: 'square',
  };
}

/** The card when there is nothing to show about: the site's own promise. */
export function defaultCard(): Card {
  return {
    kicker: 'Verse · Mumbai',
    title: 'Hire a verified musician for your session or gig',
    subtitle: 'Within 24 hours. Free to post; musicians never pay.',
    chips: ['Verified by the Verse team', 'Reply within 2 hours'],
    seed: 'verse',
    genres: [],
    monogram: 'V',
    shape: 'square',
  };
}

// --- Drawing ------------------------------------------------------------------------------------

type El = { type: string; props: { style?: Record<string, unknown>; children?: unknown; [key: string]: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Json = {}): El => ({
  type,
  props: { style, ...extra, ...(children === undefined ? {} : { children }) },
});

const INK = '#070813';
const FLEX = { display: 'flex' } as const;

/** The V of public/verse-mark.svg on its dark tile, as a data URI Satori can draw. */
const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a0a0a"/><path d="M14 18l18 30 18-30" fill="none" stroke="#6747e8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MARK_URI = `data:image/svg+xml;base64,${btoa(MARK_SVG)}`;

function titleSize(title: string) {
  return title.length <= 20 ? 88 : title.length <= 36 ? 70 : 56;
}

function art(card: Card, palette: Palette, photoDataUrl?: string): El {
  const size = card.shape === 'circle' ? 320 : 340;
  const radius = card.shape === 'circle' ? 160 : 44;
  const frame = {
    ...FLEX,
    width: size,
    height: size,
    borderRadius: radius,
    overflow: 'hidden',
    position: 'relative',
    border: '4px solid rgba(255,255,255,0.22)',
  };
  if (photoDataUrl) {
    return h('div', frame, [
      h('img', { width: size, height: size, objectFit: 'cover' }, undefined, {
        src: photoDataUrl,
        width: size,
        height: size,
      }),
    ]);
  }
  const angle = gradientAngle(card.seed);
  const circles = blobs(card.seed).map((blob) =>
    h('div', {
      position: 'absolute',
      left: `${blob.cx - blob.r / 2}%`,
      top: `${blob.cy - blob.r / 2}%`,
      width: `${blob.r}%`,
      height: `${blob.r}%`,
      borderRadius: 9999,
      background: palette.accent,
      opacity: blob.opacity * 0.5,
    }),
  );
  const bars = ribbonBars(card.seed, 16).map((height) =>
    h('div', { width: 10, height: Math.round(height * 110), borderRadius: 5, background: '#ffffff', opacity: 0.85 }),
  );
  return h('div', { ...frame, background: `linear-gradient(${angle}deg, ${palette.from}, ${palette.to})` }, [
    ...circles,
    h(
      'div',
      {
        ...FLEX,
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 34,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        height: 120,
      },
      bars,
    ),
    h(
      'div',
      {
        ...FLEX,
        position: 'absolute',
        left: 0,
        right: 0,
        top: 44,
        justifyContent: 'center',
        fontSize: 96,
        color: '#ffffff',
        opacity: 0.4,
      },
      card.monogram,
    ),
  ]);
}

/** The Satori element tree for a card. `photoDataUrl` is an already-fetched image (or undefined). */
export function cardTree(card: Card, photoDataUrl?: string): El {
  const palette = paletteFor(card.seed, card.kind, card.genres);
  const backdropBars = ribbonBars(`${card.seed}:page`, 48).map((height) =>
    h('div', {
      width: 14,
      height: Math.round(height * 150),
      borderRadius: 7,
      background: palette.accent,
      opacity: 0.16,
    }),
  );
  const chips = card.chips.map((chip) =>
    h(
      'div',
      {
        ...FLEX,
        padding: '10px 22px',
        borderRadius: 9999,
        background: 'rgba(255,255,255,0.14)',
        color: '#ffffff',
        fontSize: 28,
      },
      chip,
    ),
  );
  return h(
    'div',
    {
      ...FLEX,
      position: 'relative',
      width: SIZE.width,
      height: SIZE.height,
      background: `linear-gradient(${gradientAngle(card.seed)}deg, ${palette.from}, ${INK} 78%)`,
      color: '#ffffff',
    },
    [
      h(
        'div',
        {
          ...FLEX,
          position: 'absolute',
          left: 40,
          right: 40,
          bottom: 28,
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          height: 150,
        },
        backdropBars,
      ),
      h(
        'div',
        {
          ...FLEX,
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: 740,
          padding: '56px 0 56px 64px',
          position: 'relative',
        },
        [
          h('div', { ...FLEX, alignItems: 'center', gap: 16 }, [
            h('img', { width: 52, height: 52, borderRadius: 12 }, undefined, { src: MARK_URI, width: 52, height: 52 }),
            h('div', { ...FLEX, fontSize: 36 }, 'Verse'),
          ]),
          h('div', { ...FLEX, flexDirection: 'column' }, [
            h(
              'div',
              { ...FLEX, fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: palette.accent },
              card.kicker,
            ),
            h('div', { ...FLEX, marginTop: 14, fontSize: titleSize(card.title), lineHeight: 1.05 }, card.title),
            h(
              'div',
              { ...FLEX, marginTop: 18, fontSize: 34, color: 'rgba(255,255,255,0.82)', lineHeight: 1.25 },
              card.subtitle,
            ),
            h('div', { ...FLEX, marginTop: 30, gap: 12, flexWrap: 'wrap' }, chips),
          ]),
        ],
      ),
      h(
        'div',
        { ...FLEX, flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', paddingRight: 24 },
        [art(card, palette, photoDataUrl)],
      ),
    ],
  );
}

// --- Request handling ---------------------------------------------------------------------------

export interface Deps {
  apiOrigin: string;
  fetchJson: (url: string) => Promise<Json | null>;
  /** An image as a `data:` URI, or null when it cannot be had in time. */
  fetchImage: (url: string) => Promise<string | null>;
  render: (tree: El) => Promise<ArrayBuffer>;
}

/**
 * `professional`, `1f3a…` from the path /api/og/<type>/<id>[.png] or, failing that, ?type=&id= (an optional
 * `.png` on the id is dropped).
 */
export function parseRequest(url: URL): { type: CardType; id: string } | null {
  const fromPath = /\/api\/og\/([^/?#]+)\/([^/?#]+)\/?$/.exec(url.pathname);
  const type = (fromPath ? fromPath[1] : url.searchParams.get('type')) as CardType | null;
  const id = (fromPath ? fromPath[2] : url.searchParams.get('id') || '').replace(/\.png$/i, '');
  if (!type || !CARD_TYPES.includes(type) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { type, id };
}

const ENDPOINT: Record<CardType, (id: string) => string> = {
  professional: (id) => `/api/public/talent/${encodeURIComponent(id)}`,
  opportunity: (id) => `/api/jobs/${encodeURIComponent(id)}`,
  act: (id) => `/api/public/acts/${encodeURIComponent(id)}`,
};

/** The card for a lookup, or null when the API had nothing usable. */
export async function loadCard(type: CardType, id: string, deps: Pick<Deps, 'apiOrigin' | 'fetchJson'>) {
  const body = await deps.fetchJson(`${deps.apiOrigin}${ENDPOINT[type](id)}`);
  if (!body) return null;
  if (type === 'professional') return professionalCard(id, (body.professional as Json) ?? {});
  if (type === 'opportunity') return opportunityCard(id, (body.job as Json) ?? {});
  return actCard(id, (body.act as Json) ?? {});
}

async function png(tree: El, deps: Deps, cache: string) {
  const image = await deps.render(tree);
  return new Response(image, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': cache } });
}

/** Answers one request: the card for the id, else the default card. Never throws to the caller. */
export async function respond(request: Request, deps: Deps): Promise<Response> {
  const wanted = parseRequest(new URL(request.url));
  let card: Card | null = null;
  if (wanted) {
    try {
      card = await loadCard(wanted.type, wanted.id, deps);
    } catch {
      card = null;
    }
  }
  if (!card) return png(cardTree(defaultCard()), deps, CACHE_FALLBACK);
  const photo = card.photoUrl ? await deps.fetchImage(card.photoUrl).catch(() => null) : null;
  try {
    return await png(cardTree(card, photo ?? undefined), deps, CACHE_OK);
  } catch {
    // A photo the renderer cannot decode must not cost the whole card: draw the art instead.
    try {
      return await png(cardTree(card), deps, CACHE_OK);
    } catch {
      return png(cardTree(defaultCard()), deps, CACHE_FALLBACK);
    }
  }
}

const TIMEOUT_MS = 4000;
const MAX_IMAGE_BYTES = 2_000_000;

async function fetchJson(url: string): Promise<Json | null> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response.ok ? ((await response.json()) as Json) : null;
}

async function fetchImage(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  // WebP is left out on purpose: the renderer's WebP support is not guaranteed and a photo it cannot
  // decode would draw as an empty circle. Those people get the generated art instead.
  if (!response.ok || !/^image\/(jpeg|png)$/.test(type)) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** Answers a request with the given renderer; the origin of the public API comes from OG_API_ORIGIN. */
export function handle(request: Request, render: Deps['render']): Promise<Response> {
  const apiOrigin = (process.env.OG_API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  return respond(request, { apiOrigin, fetchJson, fetchImage, render });
}

/** The static default card, for when drawing fails altogether (so a share link always has an image). */
export function staticFallback(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: new URL('/og-default.png', request.url).toString(), 'Cache-Control': CACHE_FALLBACK },
  });
}
