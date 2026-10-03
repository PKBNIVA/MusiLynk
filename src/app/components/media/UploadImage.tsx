import type { ReactEventHandler } from 'react';
import { hasVariants, imageSizes, srcSetAttr, type ImagePlacement, type ImageSet } from '../../lib/imageSet';

type Props = {
  /** The API's responsive payload for the upload (null before its variants exist). */
  image?: ImageSet | null;
  /** The plain URL, used when there is no image set (older uploads, Google pictures, external links). */
  src?: string | null;
  alt: string;
  placement: ImagePlacement;
  /** The box the image fills, for a fixed-size placement (avatar, thumb) or when the set has no size. */
  width?: number;
  height?: number;
  /** Above the fold: eager, high priority. Everything else lazy-loads. */
  priority?: boolean;
  className?: string;
  onError?: ReactEventHandler<HTMLImageElement>;
  referrerPolicy?: 'no-referrer';
  'data-testid'?: string;
};

/**
 * An uploaded image: a `<picture>` offering the AVIF variants, then the WebP ones, then the original,
 * with `sizes` for its placement so a phone never downloads the 1600 px copy for a 56 px avatar;
 * width/height always set (the box, else the original's size) so nothing shifts when it loads;
 * lazy below the fold, async decoding. Without a set it is the same `<img>` on the plain URL. The
 * `<picture>` has `display: contents`, so `className` lays the `<img>` out as if it stood alone.
 */
export function UploadImage({
  image,
  src,
  alt,
  placement,
  width,
  height,
  priority = false,
  className = '',
  onError,
  referrerPolicy,
  'data-testid': testId,
}: Props) {
  const set = hasVariants(image) ? image : null;
  const url = set?.src || src || undefined;
  if (!url) return null;
  const w = width ?? set?.width ?? undefined;
  const h = height ?? set?.height ?? undefined;
  const sizes = imageSizes(placement, width);
  const img = (
    <img
      src={url}
      alt={alt}
      width={w}
      height={h}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      referrerPolicy={referrerPolicy}
      className={className}
      onError={onError}
      data-testid={testId}
    />
  );
  if (!set) return img;
  const avif = srcSetAttr(set.srcset.avif);
  const webp = srcSetAttr(set.srcset.webp);
  return (
    <picture className="contents">
      {avif && <source type="image/avif" srcSet={avif} sizes={sizes} />}
      {webp && <source type="image/webp" srcSet={webp} sizes={sizes} />}
      {img}
    </picture>
  );
}
