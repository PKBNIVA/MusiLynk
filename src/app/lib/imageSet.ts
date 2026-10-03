/**
 * Responsive payload the API attaches to an uploaded image that has generated variants
 * (backend ImageSet): the original as `src`, the AVIF/WebP candidates as srcset lists and the
 * original's size. Absent (null) for uploads without variants, which then render from their URL.
 */
export interface ImageSet {
  src: string;
  srcset: { avif?: string[]; webp?: string[] };
  width: number | null;
  height: number | null;
}

/** Where an uploaded image sits, so `sizes` tells the browser how wide it will render. */
export type ImagePlacement = 'avatar' | 'card' | 'header' | 'post' | 'postTile' | 'thumb';

/**
 * `sizes` per placement. The directory and act grids are one column on a phone, two from 640px and
 * three (about 320px wide) from 1024px; a post fills the feed column (600px at most on desktop) or
 * half of it in a two-up grid; a header cover spans the page (960px at most).
 */
export const IMAGE_SIZES: Record<Exclude<ImagePlacement, 'avatar' | 'thumb'>, string> = {
  card: '(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw',
  header: '(min-width: 1024px) 960px, 100vw',
  post: '(min-width: 1024px) 600px, 100vw',
  postTile: '(min-width: 1024px) 300px, 50vw',
};

/** The `sizes` attribute: a fixed box (avatar, thumb) is its pixel width, anything else its placement rule. */
export function imageSizes(placement: ImagePlacement, boxWidth?: number): string {
  if (placement === 'avatar' || placement === 'thumb') return `${boxWidth ?? 40}px`;
  return IMAGE_SIZES[placement];
}

/** `["u/v/320.webp 320w", ...]` -> the srcset attribute, or undefined when the format has no candidates. */
export function srcSetAttr(candidates: readonly string[] | undefined): string | undefined {
  return candidates && candidates.length > 0 ? candidates.join(', ') : undefined;
}

/** True when the payload can feed a <picture>: a source and at least one candidate list. */
export function hasVariants(image: ImageSet | null | undefined): image is ImageSet {
  return Boolean(image && image.src && ((image.srcset.avif?.length ?? 0) > 0 || (image.srcset.webp?.length ?? 0) > 0));
}
