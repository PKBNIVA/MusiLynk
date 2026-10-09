import { IMAGE_CREDITS } from '../../pages/public/imageCredits';
import { HERO_PHOTO, HERO_PHOTO_SIZES, ROLE_PHOTOS, ROLE_PHOTO_FALLBACK } from '../../lib/photo';

/** One editorial photograph from public/img, ready for `<Photo>`. Credits live on /credits. */
export type EditorialPhoto = { src: string; alt: string; width: number; height: number };

const byFile = new Map(IMAGE_CREDITS.map((credit) => [credit.file, credit]));

/** `editorialPhoto('veena-concert')` -> the base path, description and intrinsic size of the 1600 variant. */
export function editorialPhoto(file: string): EditorialPhoto {
  const credit = byFile.get(file);
  if (!credit) throw new Error(`No photo named "${file}" in src/app/pages/public/imageCredits.ts`);
  return { src: `/img/${credit.file}`, alt: credit.alt, width: credit.width, height: credit.height };
}

/** The landing hero photo and how wide it renders (both from src/app/lib/photo.ts, shared with the HTML preload). */
export { HERO_PHOTO, HERO_PHOTO_SIZES };

export { ROLE_PHOTOS };

/** The photo for a role slug; unknown roles fall back to the rehearsal room. */
export const rolePhoto = (slug: string) => editorialPhoto(ROLE_PHOTOS[slug.toLowerCase()] ?? ROLE_PHOTO_FALLBACK);
