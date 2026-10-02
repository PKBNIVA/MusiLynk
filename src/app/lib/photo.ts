/**
 * Editorial photos live in /img as `<name>-800.webp` and `<name>-1600.webp`. These helpers
 * build the srcset for one and pick the intrinsic size to declare so the layout never shifts.
 */

export const PHOTO_WIDTHS = [800, 1600] as const;
/** Photos that are the first thing on a page (the home hero) also ship 640, 960 and 1280 px files, so a phone at 2 to 3x density never downloads the 1600. */
export const HERO_PHOTO_WIDTHS = [640, 800, 960, 1280, 1600] as const;

const ALL_WIDTHS: readonly number[] = HERO_PHOTO_WIDTHS;

/** `/img/hero-tabla` -> `/img/hero-tabla-800.webp 800w, /img/hero-tabla-1600.webp 1600w`. */
export function photoSrcSet(base: string, widths: readonly number[] = PHOTO_WIDTHS): string {
  return widths.map((w) => `${photoUrl(base, w)} ${w}w`).join(', ');
}

/** The file for one width; unknown widths fall back to the largest. */
export function photoUrl(base: string, width: number = PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]): string {
  const w = ALL_WIDTHS.includes(width) ? width : PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
  return `${base.replace(/\.webp$/, '').replace(/-(640|800|960|1280|1600)$/, '')}-${w}.webp`;
}

/** Largest centred square in a w x h image: where to start reading and how long each side is. */
export function squareCropRect(width: number, height: number) {
  const side = Math.max(1, Math.min(width, height));
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** Edge length in pixels of an uploaded profile or act photo. */
export const PROFILE_PHOTO_PX = 512;
