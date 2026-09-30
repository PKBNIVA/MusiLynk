import { describe, expect, it } from 'vitest';
import { photoSrcSet, photoUrl, squareCropRect } from '../photo';

describe('photo helpers', () => {
  it('builds the srcset from a base path', () => {
    expect(photoSrcSet('/img/tabla-hands')).toBe('/img/tabla-hands-800.webp 800w, /img/tabla-hands-1600.webp 1600w');
  });
  it('accepts a base that already carries a size or extension', () => {
    expect(photoUrl('/img/a-800.webp', 800)).toBe('/img/a-800.webp');
    expect(photoUrl('/img/a-1600', 800)).toBe('/img/a-800.webp');
    expect(photoUrl('/img/a.webp', 800)).toBe('/img/a-800.webp');
  });
  it('defaults to, and falls back to, the largest width', () => {
    expect(photoUrl('/img/a')).toBe('/img/a-1600.webp');
    expect(photoUrl('/img/a', 1234)).toBe('/img/a-1600.webp');
  });
});

describe('squareCropRect', () => {
  it('centres the square on the longer side', () => {
    expect(squareCropRect(1600, 900)).toEqual({ sx: 350, sy: 0, side: 900 });
    expect(squareCropRect(900, 1600)).toEqual({ sx: 0, sy: 350, side: 900 });
    expect(squareCropRect(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });
  it('never returns a zero-sized square', () => {
    expect(squareCropRect(0, 0).side).toBe(1);
  });
});
