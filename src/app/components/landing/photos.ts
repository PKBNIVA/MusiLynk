import { IMAGE_CREDITS } from '../../pages/public/imageCredits';
import { HERO_PHOTO } from '../../lib/photo';

/** One editorial photograph from public/img, ready for `<Photo>`. Credits live on /credits. */
export type EditorialPhoto = { src: string; alt: string; width: number; height: number };

const byFile = new Map(IMAGE_CREDITS.map((credit) => [credit.file, credit]));

/** `editorialPhoto('veena-concert')` -> the base path, description and intrinsic size of the 1600 variant. */
export function editorialPhoto(file: string): EditorialPhoto {
  const credit = byFile.get(file);
  if (!credit) throw new Error(`No photo named "${file}" in src/app/pages/public/imageCredits.ts`);
  return { src: `/img/${credit.file}`, alt: credit.alt, width: credit.width, height: credit.height };
}

/** The landing hero photo (src/app/lib/photo.ts) and how wide it renders: the right 42% on desktop, full width on a phone. */
export { HERO_PHOTO };
export const HERO_PHOTO_SIZES = '(min-width: 1024px) 42vw, 100vw';

/** The photo behind each hire page and role tile, keyed by the SEO role slug (seoPages.ts). */
export const ROLE_PHOTOS: Readonly<Record<string, string>> = {
  drummer: 'drummer-stage',
  guitarist: 'guitarist-stage',
  bassist: 'rehearsal-room',
  'keyboard-player': 'keyboard-player',
  singer: 'carnatic-vocalist',
  'tabla-player': 'tabla-kolkata',
  'dhol-player': 'wedding-band',
  violinist: 'violinist',
  saxophonist: 'saxophonist',
  dj: 'dj-goa',
  'sound-engineer': 'sound-desk',
  'music-producer': 'recording-studio',
};

/** The photo for a role slug; unknown roles fall back to the rehearsal room. */
export const rolePhoto = (slug: string) => editorialPhoto(ROLE_PHOTOS[slug.toLowerCase()] ?? 'rehearsal-room');
