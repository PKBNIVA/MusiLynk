/**
 * Editorial photos live in /img as `<name>-800.webp` and `<name>-1600.webp`. These helpers
 * build the srcset for one and pick the intrinsic size to declare so the layout never shifts.
 */

export const PHOTO_WIDTHS = [800, 1600] as const;

/** `/img/hero-tabla` -> `/img/hero-tabla-800.webp 800w, /img/hero-tabla-1600.webp 1600w`. */
export function photoSrcSet(base: string): string {
  return PHOTO_WIDTHS.map((w) => `${photoUrl(base, w)} ${w}w`).join(', ');
}

/** The file for one width; unknown widths fall back to the largest. */
export function photoUrl(base: string, width: number = PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]): string {
  const w = (PHOTO_WIDTHS as readonly number[]).includes(width) ? width : PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
  return `${base.replace(/\.webp$/, '').replace(/-(800|1600)$/, '')}-${w}.webp`;
}
