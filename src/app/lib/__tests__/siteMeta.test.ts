import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PUBLIC_ORIGIN,
  PUBLIC_PAGE_META,
  absoluteUrl,
  clipDescription,
  documentTitle,
  publicOrigin,
} from '../siteMeta';

describe('siteMeta', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses VITE_PUBLIC_URL without its trailing slash, else the live site', () => {
    vi.stubEnv('VITE_PUBLIC_URL', 'https://preview.musilynk.example/');
    expect(publicOrigin()).toBe('https://preview.musilynk.example');
    expect(absoluteUrl('/hire/dj/mumbai')).toBe('https://preview.musilynk.example/hire/dj/mumbai');
    expect(absoluteUrl('https://elsewhere.example/x')).toBe('https://elsewhere.example/x');
    vi.stubEnv('VITE_PUBLIC_URL', '');
    expect(publicOrigin()).toBe(DEFAULT_PUBLIC_ORIGIN);
  });
  it('suffixes the site name unless the title already carries it, and clips descriptions at 160', () => {
    expect(documentTitle('Pricing', 'MusiLynk')).toBe('Pricing · MusiLynk');
    expect(documentTitle('How to use MusiLynk', 'MusiLynk')).toBe('How to use MusiLynk');
    expect(clipDescription('short')).toBe('short');
    const long = 'x'.repeat(200);
    expect(clipDescription(long)).toHaveLength(158);
    expect(clipDescription(long).endsWith('…')).toBe(true);
  });
  it('has a title and a description for every pre-rendered page, each fitting a search snippet', () => {
    for (const path of [
      '/',
      '/music-jobs',
      '/music-professionals',
      '/book-music',
      '/urgent',
      '/pricing',
      '/guide',
      '/join/hiring',
      '/join/musician',
    ]) {
      const meta = PUBLIC_PAGE_META[path];
      expect(meta, path).toBeDefined();
      expect(meta.title.length, path).toBeGreaterThan(5);
      expect(meta.title.length, path).toBeLessThanOrEqual(70);
      expect(meta.description.length, path).toBeLessThanOrEqual(170);
    }
  });
});
