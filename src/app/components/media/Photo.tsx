import { photoSrcSet, photoUrl } from '../../lib/photo';

type Props = {
  /** Base path of an editorial photo, e.g. `/img/tabla-hands` (no size or extension), or any full URL. */
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  /** Above-the-fold image: loads eagerly and at high priority. */
  priority?: boolean;
  /** Widths to offer in the srcset; only the home hero ships more than 480, 800 and 1600. */
  widths?: readonly number[];
  className?: string;
};

/**
 * An image with explicit dimensions (no layout shift), lazy loading and async decoding. An editorial
 * photo (`/img/<name>`) becomes a `<picture>` offering the AVIF variants first and the WebP ones as
 * the fallback, each with a srcset of every width scripts/perf/build-photos.mjs generated. The
 * `<picture>` has `display: contents`, so `className` lays the `<img>` out as if it stood alone.
 */
export function Photo({ src, alt, width, height, sizes = '100vw', priority = false, widths, className = '' }: Props) {
  const editorial = src.startsWith('/img/') && !/\.[a-z0-9]+$/i.test(src);
  const img = (
    <img
      src={editorial ? photoUrl(src, 1600) : src}
      srcSet={editorial ? photoSrcSet(src, widths) : undefined}
      sizes={editorial ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      className={className}
    />
  );
  if (!editorial) return img;
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={photoSrcSet(src, widths, 'avif')} sizes={sizes} />
      {img}
    </picture>
  );
}
