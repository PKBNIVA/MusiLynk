const SIZES = { sm: 32, md: 40, lg: 56, xl: 96 } as const;
const FONT = { sm: 12, md: 14, lg: 20, xl: 34 } as const;

/** Stable 0-359 hue from an id, so a person keeps the same colour everywhere. */
export function avatarHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) % 360;
}

/** One or two initials: first letters of the first and last words of the name. */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0])[0] || '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

type Props = {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  /** True when the name is visible beside the avatar, so screen readers do not hear it twice. */
  decorative?: boolean;
  className?: string;
};

/** Initials disc with a deterministic hue. There are no user photos on Verse. */
export function UserAvatar({ id, name, size = 'md', decorative = true, className = '' }: Props) {
  const h = avatarHue(String(id));
  const px = SIZES[size];
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name };
  return (
    <span
      {...a11y}
      data-testid="user-avatar"
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
