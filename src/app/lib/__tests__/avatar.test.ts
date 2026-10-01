import { describe, expect, it } from 'vitest';
import { AVATAR_FONT, AVATAR_SIZES, avatarHue, initialsOf } from '../avatar';

describe('avatar helpers', () => {
  it('has a size and a font size for every step', () => {
    expect(Object.keys(AVATAR_SIZES)).toEqual(Object.keys(AVATAR_FONT));
  });
  it('has a stable hue per id', () => {
    expect(avatarHue('abc')).toBe(avatarHue('abc'));
    expect(avatarHue('abc')).not.toBe(avatarHue('abd'));
    expect(avatarHue('abc')).toBeLessThan(360);
  });
  it('takes one or two initials', () => {
    expect(initialsOf('Asha Sharma')).toBe('AS');
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('a b c')).toBe('AC');
  });
});
