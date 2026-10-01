/** Sizes shared by the initials disc (UserAvatar) and the generated-art disc (ArtAvatar). */
export const AVATAR_SIZES = { sm: 32, md: 40, lg: 56, xl: 96 } as const;
export const AVATAR_FONT = { sm: 12, md: 14, lg: 20, xl: 34 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;

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
