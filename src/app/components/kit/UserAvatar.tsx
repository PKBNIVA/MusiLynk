import { useEffect, useState } from 'react';
import { ArtAvatar } from '../media/ArtAvatar';
import { AVATAR_FONT as FONT, AVATAR_SIZES as SIZES, avatarHue, initialsOf, type AvatarSize } from '../../lib/avatar';

export { avatarHue, initialsOf };

type Props = {
  id: string;
  name: string;
  size?: AvatarSize;
  /** True when the name is visible beside the avatar, so screen readers do not hear it twice. */
  decorative?: boolean;
  className?: string;
  /** A photo the person uploaded (or their Google picture). Wins over everything else. */
  photoUrl?: string | null;
  /** Draw generated art instead of initials. Demo accounts always get it (see `demo`). */
  art?: boolean;
  /** Demo/showcase account: art rather than a faceless disc, never a photo of anyone. */
  demo?: boolean;
  genres?: readonly string[];
};

/**
 * One person, one avatar: their photo when they have one, generated art for demo accounts (or
 * when `art` is set), otherwise initials on a colour that is stable per id. A photo that fails to
 * load falls through to the next layer.
 */
export function UserAvatar({
  id,
  name,
  size = 'md',
  decorative = true,
  className = '',
  photoUrl,
  art = false,
  demo = false,
  genres,
}: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [photoUrl]);
  const px = SIZES[size];
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name };
  if (photoUrl && failed !== photoUrl) {
    return (
      <span
        {...a11y}
        data-testid="user-avatar"
        data-layer="photo"
        className={`inline-flex shrink-0 select-none overflow-hidden rounded-full bg-white/10 ${className}`}
        style={{ width: px, height: px }}
      >
        <img
          src={photoUrl}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(photoUrl)}
        />
      </span>
    );
  }
  if (art || demo) {
    return <ArtAvatar id={id} name={name} size={size} genres={genres} decorative={decorative} className={className} />;
  }
  const h = avatarHue(String(id));
  return (
    <span
      {...a11y}
      data-testid="user-avatar"
      data-layer="initials"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ${className}`}
      style={{
        width: px,
        height: px,
        fontSize: FONT[size],
        letterSpacing: '0.02em',
        background: `hsl(${h} 55% 28%)`,
        color: `hsl(${h} 90% 85%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
