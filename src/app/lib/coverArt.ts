/**
 * Pure maths behind CoverArt, ArtAvatar and WaveformStrip: a stable hash, a small seeded
 * random source, the genre-family palettes and the bar heights. Nothing here touches the DOM,
 * so the same seed always draws the same picture on the server, in tests and in the browser.
 */

/** Stable unsigned 32-bit hash of a string (cyrb53-style mixing, folded to 32 bits). */
export function hashSeed(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** mulberry32: a tiny seeded generator returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Palette = { name: string; from: string; to: string; accent: string };

/** Twelve palettes, one per genre family. Dark enough that white marks stay visible on every one. */
export const PALETTES: readonly Palette[] = [
  { name: 'hindustani', from: '#7c2d12', to: '#d97706', accent: '#fcd34d' },
  { name: 'carnatic', from: '#064e3b', to: '#0d9488', accent: '#5eead4' },
  { name: 'devotional', from: '#701a75', to: '#be123c', accent: '#fda4af' },
  { name: 'film', from: '#9d174d', to: '#ea580c', accent: '#fdba74' },
  { name: 'folk', from: '#7f1d1d', to: '#ca8a04', accent: '#fde047' },
  { name: 'rock', from: '#1c1917', to: '#b91c1c', accent: '#f87171' },
  { name: 'indie', from: '#4c1d95', to: '#0284c7', accent: '#7dd3fc' },
  { name: 'jazz', from: '#1e1b4b', to: '#1d4ed8', accent: '#93c5fd' },
  { name: 'electronic', from: '#312e81', to: '#0891b2', accent: '#67e8f9' },
  { name: 'hiphop', from: '#171717', to: '#4d7c0f', accent: '#bef264' },
  { name: 'world', from: '#134e4a', to: '#7c3aed', accent: '#c4b5fd' },
  { name: 'default', from: '#312e81', to: '#a21caf', accent: '#f0abfc' },
] as const;

const FAMILY_WORDS: readonly (readonly [string, readonly string[]])[] = [
  ['hindustani', ['hindustani', 'classical', 'raga', 'khayal', 'dhrupad', 'tabla', 'sitar', 'sarod', 'santoor']],
  ['carnatic', ['carnatic', 'veena', 'mridangam', 'kutcheri']],
  ['devotional', ['sufi', 'qawwali', 'ghazal', 'bhajan', 'devotional', 'kirtan', 'gospel', 'religious', 'worship']],
  ['film', ['bollywood', 'film', 'playback', 'cinema', 'ott', 'soundtrack']],
  ['folk', ['folk', 'dhol', 'bhangra', 'lavani', 'baul', 'garba', 'punjabi', 'regional']],
  ['rock', ['rock', 'metal', 'punk', 'grunge', 'alternative']],
  ['indie', ['indie', 'pop', 'singer-songwriter', 'acoustic', 'unplugged']],
  ['jazz', ['jazz', 'blues', 'soul', 'funk', 'swing']],
  ['electronic', ['edm', 'electronic', 'house', 'techno', 'trance', 'dj', 'synth']],
  ['hiphop', ['hip-hop', 'hip hop', 'hiphop', 'rap', 'trap']],
  ['world', ['fusion', 'world', 'latin', 'reggae']],
];

/** The family name for the first genre (or role) that matches a known word, else null. */
export function genreFamily(genres: readonly string[] = []): string | null {
  for (const genre of genres) {
    const text = String(genre).toLowerCase();
    for (const [family, words] of FAMILY_WORDS) {
      if (words.some((word) => text.includes(word))) return family;
    }
  }
  return null;
}

/**
 * Palette for an entity: its genre family when one matches; otherwise the kind (or, failing
 * that, the seed) picks one of the twelve so two unrelated cards rarely look alike.
 */
export function paletteFor(seed: string, kind?: string | null, genres: readonly string[] = []): Palette {
  const family = genreFamily(genres);
  const found = family ? PALETTES.find((p) => p.name === family) : undefined;
  if (found) return found;
  return PALETTES[hashSeed(`${kind || seed}:palette`) % PALETTES.length];
}

/** `count` bar heights in [0.12, 1] that rise and fall like a phrase of audio, from the seed. */
export function ribbonBars(seed: string, count = 48): number[] {
  const random = seededRandom(hashSeed(`${seed}:bars`));
  const phase = random() * Math.PI * 2;
  const wobble = 0.8 + random() * 1.6;
  return Array.from({ length: count }, (_, i) => {
    const swell = 0.5 + 0.5 * Math.sin(phase + (i / count) * Math.PI * wobble * 2);
    return Math.round((0.12 + 0.88 * (0.55 * swell + 0.45 * random())) * 1000) / 1000;
  });
}

export type Blob = { cx: number; cy: number; r: number; opacity: number };

/**
 * Bounds that keep the soft circles soft: none may grow into one big flat disc that swallows the
 * card (a radius of 40 is at most half of the square field's area), and none is opaque.
 */
export const BLOB_RADIUS = { min: 24, max: 40 } as const;
export const BLOB_MAX_OPACITY = 0.45;

/** Three soft circles in a 100x100 field, placed from the seed, with radius and opacity clamped. */
export function blobs(seed: string): Blob[] {
  const random = seededRandom(hashSeed(`${seed}:blobs`));
  return [0, 1, 2].map((i) => {
    const r = BLOB_RADIUS.min + random() * (BLOB_RADIUS.max - BLOB_RADIUS.min) - i * 2;
    return {
      cx: Math.round((10 + random() * 80) * 10) / 10,
      cy: Math.round((10 + random() * 80) * 10) / 10,
      r: Math.round(Math.max(BLOB_RADIUS.min, Math.min(BLOB_RADIUS.max, r)) * 10) / 10,
      opacity: Math.min(BLOB_MAX_OPACITY, Math.round((BLOB_MAX_OPACITY - i * 0.1) * 100) / 100),
    };
  });
}

/** Gradient angle in degrees, varied per seed so same-palette cards do not line up. */
export function gradientAngle(seed: string): number {
  return 20 + (hashSeed(`${seed}:angle`) % 140);
}

/**
 * Peaks from work-sample metadata (`media_metadata.waveform`) as exactly `count` values in
 * [0, 1], or null when there is nothing usable. Longer series are averaged down, shorter ones
 * stretched, and values above 1 are scaled by the series maximum.
 */
export function normalizePeaks(raw: unknown, count = 64): number[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map((v) => Math.abs(v));
  if (values.length === 0) return null;
  const max = Math.max(...values, 1e-9);
  const scale = max > 1 ? max : 1;
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i / count) * values.length);
    const end = Math.max(start + 1, Math.floor(((i + 1) / count) * values.length));
    const slice = values.slice(start, end);
    const mean = slice.reduce((sum, v) => sum + v, 0) / slice.length;
    return Math.round((mean / scale) * 1000) / 1000;
  });
}
