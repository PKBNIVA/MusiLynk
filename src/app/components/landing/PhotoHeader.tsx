import type { ReactNode } from 'react';
import { Photo } from '../media/Photo';
import { PHOTO_HEADER_SIZES } from '../../lib/photo';
import { editorialPhoto } from './photos';

/**
 * The top of a public page: an editorial photograph (public/img, credited on /credits) under a
 * left-to-right scrim, with the eyebrow, the page's one <h1> and a short paragraph on top. The
 * photo is decoration, so it has no alt text; it is never a picture of a listed person.
 */
export function PhotoHeader({
  photo,
  eyebrow,
  title,
  children,
  className = '',
}: {
  /** File name under public/img without size or extension, e.g. `drummer-stage`. */
  photo: string;
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const image = editorialPhoto(photo);
  return (
    <header
      className={`relative isolate overflow-hidden rounded-3xl border border-white/10 ${className}`}
      data-testid="photo-header"
    >
      <Photo
        src={image.src}
        alt=""
        width={image.width}
        height={image.height}
        sizes={PHOTO_HEADER_SIZES}
        priority
        className="absolute inset-0 -z-10 size-full object-cover"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/95 via-slate-950/80 to-slate-950/30 max-md:from-slate-950/90 max-md:to-slate-950/70"
      />
      <div className="max-w-3xl px-5 py-9 sm:px-8 md:px-10 md:py-14">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[.22em] text-violet-200">{eyebrow}</p>}
        <h1 className="mt-2 text-4xl font-bold leading-tight md:text-6xl">{title}</h1>
        {children && <div className="mt-4 text-slate-200">{children}</div>}
      </div>
    </header>
  );
}
