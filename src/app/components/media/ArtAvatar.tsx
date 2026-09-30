import { CoverArt } from './CoverArt';
import { AVATAR_FONT as FONT, AVATAR_SIZES as SIZES, initialsOf, type AvatarSize } from '../../lib/avatar';

type Props = {
  id: string;
  name: string;
  size?: AvatarSize;
  genres?: readonly string[];
  decorative?: boolean;
  className?: string;
};

/** A circular CoverArt with the person's monogram at 30% opacity: designed, but no face. */
export function ArtAvatar({ id, name, size = 'md', genres = [], decorative = true, className = '' }: Props) {
  const px = SIZES[size];
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name };
  return (
    <span
      {...a11y}
      data-testid="user-avatar"
      data-layer="art"
      className={`relative inline-flex shrink-0 select-none items-center justify-center rounded-full ${className}`}
      style={{ width: px, height: px }}
    >
      <CoverArt seed={id} genres={genres} size={px} rounded="full" bars={16} />
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center font-bold text-white"
        style={{ fontSize: FONT[size], letterSpacing: '0.02em', opacity: 0.3 }}
      >
        {initialsOf(name)}
      </span>
    </span>
  );
}
