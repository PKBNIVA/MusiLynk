import { describe, expect, it } from 'vitest';
import {
  BLOB_MAX_OPACITY,
  BLOB_RADIUS,
  PALETTES,
  blobs,
  genreFamily,
  gradientAngle,
  hashSeed,
  normalizePeaks,
  paletteFor,
  ribbonBars,
  seededRandom,
} from '../coverArt';

describe('hashSeed / seededRandom', () => {
  it('is stable and spreads similar strings', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed('')).toBeGreaterThanOrEqual(0);
  });
  it('yields the same floats in [0,1) for the same seed', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 5 }, () => a());
    expect(first).toEqual(Array.from({ length: 5 }, () => b()));
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});

describe('palettes', () => {
  it('has twelve distinct palettes', () => {
    expect(PALETTES).toHaveLength(12);
    expect(new Set(PALETTES.map((p) => p.name)).size).toBe(12);
  });
  it('maps genres to families, first match wins', () => {
    expect(genreFamily(['Ghazal'])).toBe('devotional');
    expect(genreFamily(['Carnatic'])).toBe('carnatic');
    expect(genreFamily(['Hip-Hop'])).toBe('hiphop');
    expect(genreFamily(['nothing here', 'Jazz', 'Rock'])).toBe('jazz');
    expect(genreFamily(['zzz'])).toBeNull();
    expect(genreFamily()).toBeNull();
  });
  it('uses the genre family when known, else a stable pick from kind or seed', () => {
    expect(paletteFor('x', 'gig', ['Qawwali']).name).toBe('devotional');
    expect(paletteFor('x', 'gig', [])).toBe(paletteFor('y', 'gig', []));
    expect(paletteFor('seed-1')).toBe(paletteFor('seed-1', null, ['unknown']));
  });
});

describe('ribbonBars / blobs / gradientAngle', () => {
  it('draws the requested number of bars inside range, deterministically', () => {
    const bars = ribbonBars('job-1');
    expect(bars).toHaveLength(48);
    expect(bars.every((h) => h >= 0.12 && h <= 1)).toBe(true);
    expect(ribbonBars('job-1')).toEqual(bars);
    expect(ribbonBars('job-2')).not.toEqual(bars);
    expect(ribbonBars('job-1', 16)).toHaveLength(16);
  });
  it('places three blobs inside the field', () => {
    const list = blobs('a');
    expect(list).toHaveLength(3);
    expect(list.every((b) => b.cx >= 10 && b.cx <= 90 && b.cy >= 10 && b.cy <= 90 && b.r > 20)).toBe(true);
    expect(blobs('a')).toEqual(list);
  });
  it('never draws a dominant flat circle: radius and opacity stay inside the bounds for any seed', () => {
    const seeds = [
      'Saanjh',
      'saanjh',
      '',
      'act-1',
      ...Array.from({ length: 5000 }, (_, i) => `seed-${i}-${(i * 7919) % 104729}`),
    ];
    let widest = 0;
    for (const seed of seeds) {
      for (const b of blobs(seed)) {
        widest = Math.max(widest, b.r);
        expect(b.r).toBeGreaterThanOrEqual(BLOB_RADIUS.min);
        expect(b.r).toBeLessThanOrEqual(BLOB_RADIUS.max);
        expect(b.opacity).toBeGreaterThan(0);
        expect(b.opacity).toBeLessThanOrEqual(BLOB_MAX_OPACITY);
      }
    }
    // A circle of the largest radius covers at most half of the 100x100 field.
    expect(Math.PI * widest ** 2).toBeLessThanOrEqual(0.51 * 100 * 100);
    expect(widest).toBeGreaterThan(BLOB_RADIUS.max - 1); // the range is used, not collapsed
  });
  it('varies the angle per seed within 20-159 degrees', () => {
    const angle = gradientAngle('a');
    expect(angle).toBeGreaterThanOrEqual(20);
    expect(angle).toBeLessThan(160);
    expect(gradientAngle('a')).toBe(angle);
  });
});

describe('normalizePeaks', () => {
  it('returns null for anything unusable', () => {
    expect(normalizePeaks(undefined)).toBeNull();
    expect(normalizePeaks('nope')).toBeNull();
    expect(normalizePeaks([])).toBeNull();
    expect(normalizePeaks(['a', NaN, null])).toBeNull();
  });
  it('resamples to the requested length', () => {
    expect(
      normalizePeaks(
        Array.from({ length: 200 }, (_, i) => (i % 10) / 10),
        64,
      ),
    ).toHaveLength(64);
    expect(normalizePeaks([0.5], 64)).toEqual(Array(64).fill(0.5));
  });
  it('scales integer peaks by their maximum and keeps 0-1 peaks as they are', () => {
    const scaled = normalizePeaks([0, 50, 100], 3) as number[];
    expect(scaled).toEqual([0, 0.5, 1]);
    expect(normalizePeaks([0.2, 0.4], 2)).toEqual([0.2, 0.4]);
    expect(normalizePeaks([-0.5, 'x', 0.25], 2)).toEqual([0.5, 0.25]);
  });
});
