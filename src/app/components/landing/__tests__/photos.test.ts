import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEO_ROLES } from '../../../lib/seoPages';
import { HERO_PHOTO_WIDTHS, PHOTO_WIDTHS } from '../../../lib/photo';
import { HERO_PHOTO, ROLE_PHOTOS, editorialPhoto, rolePhoto } from '../photos';

const PUBLIC = join(process.cwd(), 'public');

describe('landing photos', () => {
  it('looks a photo up by name, with its size and description', () => {
    const photo = editorialPhoto(HERO_PHOTO);
    expect(photo.src).toBe(`/img/${HERO_PHOTO}`);
    expect(photo.width).toBe(1600);
    expect(photo.height).toBeGreaterThan(600);
    expect(photo.alt.length).toBeGreaterThan(10);
    expect(() => editorialPhoto('nope')).toThrow(/No photo named/);
  });
  it('ships every responsive width of the hero photo in AVIF and WebP', () => {
    for (const w of HERO_PHOTO_WIDTHS)
      for (const ext of ['avif', 'webp'])
        expect(existsSync(join(PUBLIC, `${editorialPhoto(HERO_PHOTO).src}-${w}.${ext}`)), `${w}.${ext}`).toBe(true);
  });
  it('has a shipped photo for every one of the 12 SEO roles', () => {
    for (const [slug] of SEO_ROLES) {
      const photo = rolePhoto(slug);
      for (const w of PHOTO_WIDTHS)
        for (const ext of ['avif', 'webp'])
          expect(existsSync(join(PUBLIC, `${photo.src}-${w}.${ext}`)), slug).toBe(true);
    }
    expect(Object.keys(ROLE_PHOTOS).sort()).toEqual(SEO_ROLES.map(([slug]) => slug).sort());
  });
  it('falls back to the rehearsal room for an unknown role', () => {
    expect(rolePhoto('theremin-player').src).toBe('/img/rehearsal-room');
  });
});
