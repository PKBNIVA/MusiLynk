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
  className?: string;
};

/** An `<img>` with explicit dimensions (no layout shift), lazy loading and the 800/1600 srcset. */
export function Photo({ src, alt, width, height, sizes = '100vw', priority = false, className = '' }: Props) {
  const editorial = src.startsWith('/img/') && !/\.[a-z0-9]+$/i.test(src);
  return (
    <img
      src={editorial ? photoUrl(src, 1600) : src}
      srcSet={editorial ? photoSrcSet(src) : undefined}
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
}
