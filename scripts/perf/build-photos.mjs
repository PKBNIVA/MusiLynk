#!/usr/bin/env node
// Generates the responsive variants of the editorial photos in public/img (the home hero, the role
// tiles, the hire-page headers): AVIF and WebP at every width in src/app/lib/photo.ts, so
// <Photo> can offer `<picture>` with an AVIF source and a WebP fallback.
//
//   npm i --no-save sharp          # not a project dependency: this runs once per new photo, by hand
//   node scripts/perf/build-photos.mjs [--src <dir>] [--only <name>] [--force] [--check]
//
// Sources: `<dir>/<name>.jpg|.png|.webp` when --src names a folder of originals (the licensed files
// are not committed; see src/app/pages/public/imageCredits.ts for where they come from), otherwise
// the committed `<name>-1600.webp` is the source for the smaller sizes. Existing files are kept
// unless --force. --check only lists the variants that are missing and exits 1 if any are.
// Outputs are committed under public/img; vercel.json caches /img for a week.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HERO_PHOTO, HERO_PHOTO_WIDTHS, PHOTO_WIDTHS } from '../../src/app/lib/photo.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const imgDir = join(root, 'public', 'img');
const FORMATS = ['webp', 'avif'];
// AVIF at quality 50 is visually on a par with WebP at 75 for photographs, at roughly half the bytes
// from an original. Cut from an already lossy WebP it can come out larger, so the AVIF quality steps
// down (never below the floor) until the file is smaller than the WebP it stands in for.
const WEBP_QUALITY = 75;
const AVIF_QUALITIES = [50, 44, 38, 32];
const ENCODERS = {
  avif: (img, quality = AVIF_QUALITIES[0]) => img.avif({ quality, effort: 6 }),
  webp: (img) => img.webp({ quality: WEBP_QUALITY, effort: 6 }),
};

const argv = process.argv.slice(2);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const srcDir = option('--src') ? resolve(option('--src')) : null;
const only = option('--only');
const force = argv.includes('--force');
const check = argv.includes('--check');

/** Every photo name in public/img (`<name>-1600.webp` is the one file each photo always has). */
export function photoNames(dir = imgDir) {
  return readdirSync(dir)
    .map((file) => /^(.+)-1600\.webp$/.exec(file)?.[1])
    .filter(Boolean)
    .sort();
}

/** The variant files one photo needs: every width in both formats; the hero has its own widths. */
export function variantsFor(name) {
  const widths = name === HERO_PHOTO ? HERO_PHOTO_WIDTHS : PHOTO_WIDTHS;
  return FORMATS.flatMap((format) => widths.map((width) => ({ file: `${name}-${width}.${format}`, width, format })));
}

function sourceFor(name) {
  if (srcDir) {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const candidate = join(srcDir, `${name}.${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return join(imgDir, `${name}-1600.webp`);
}

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    // SHARP_PATH: a folder whose node_modules holds sharp (e.g. an npx cache), for machines without it installed.
    if (process.env.SHARP_PATH) return createRequire(join(process.env.SHARP_PATH, 'package.json'))('sharp');
    throw new Error(
      'sharp is not installed: run `npm i --no-save sharp` first (it is deliberately not a project dependency).',
    );
  }
}

const names = photoNames().filter((name) => !only || name === only);
const missing = names.flatMap((name) => variantsFor(name).filter((v) => !existsSync(join(imgDir, v.file))));
if (check) {
  for (const v of missing) console.log(`missing: public/img/${v.file}`);
  console.log(
    missing.length ? `${missing.length} variant(s) missing` : `every variant of ${names.length} photos is present`,
  );
  process.exit(missing.length ? 1 : 0);
}

const sharp = await loadSharp();
let written = 0;
for (const name of names) {
  const source = sourceFor(name);
  const { width: sourceWidth } = await sharp(source).metadata();
  for (const { file, width, format } of variantsFor(name)) {
    const out = join(imgDir, file);
    if (existsSync(out) && !force) continue;
    if (format === 'webp' && source === join(imgDir, file)) continue; // the fallback source itself
    if (width > sourceWidth) {
      console.warn(`skip ${file}: source is only ${sourceWidth}px wide`);
      continue;
    }
    const resized = () => sharp(source).rotate().resize({ width, withoutEnlargement: true });
    await ENCODERS[format](resized()).toFile(out);
    if (format === 'avif') {
      const webp = join(imgDir, `${name}-${width}.webp`);
      for (const quality of AVIF_QUALITIES.slice(1)) {
        if (!existsSync(webp) || statSync(out).size < statSync(webp).size) break;
        await ENCODERS.avif(resized(), quality).toFile(out);
      }
    }
    written += 1;
    console.log(
      `${file.padEnd(36)} ${(statSync(out).size / 1024).toFixed(1).padStart(6)} kB  <- ${source.replace(root + '/', '')}`,
    );
  }
}
console.log(`build-photos: wrote ${written} file(s) for ${names.length} photo(s) into public/img`);
