#!/usr/bin/env node
// Checks the production build in dist/ against bundle-budget.json.
//
// Measured (gzip, level 9, like a CDN would serve it):
//   entryChunk      the <script type="module"> in dist/index.html
//   initialJs       the entry plus every <link rel="modulepreload"> (what the first page
//                   load downloads before any route chunk)
//   largestChunk    the biggest .js file in dist/assets (any lazily loaded chunk)
//   css             the stylesheets linked from dist/index.html
//
// Usage: npm run build && node scripts/check-bundle-size.mjs [--json] [--dist DIR] [--budget FILE]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
};
const dist = option('--dist', join(root, 'dist'));
const budgetPath = option('--budget', join(root, 'bundle-budget.json'));

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${join(dist, 'index.html')} not found: run \`npm run build\` first.`);
  process.exit(2);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const gz = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const attr = (pattern) => [...html.matchAll(pattern)].map((match) => match[1].replace(/^\//, ''));

const entries = attr(/<script[^>]*type="module"[^>]*src="([^"]+)"/g);
const preloads = attr(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g);
const styles = attr(/<link[^>]*rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"/g);
if (entries.length !== 1) {
  console.error(`Expected one module entry script in dist/index.html, found ${entries.length}.`);
  process.exit(2);
}

const chunks = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, gzip: gz(join('assets', name)) }))
  .sort((a, b) => b.gzip - a.gzip);

const actual = {
  entryChunk: { bytes: gz(entries[0]), detail: entries[0] },
  initialJs: {
    bytes: [...entries, ...preloads].reduce((sum, file) => sum + gz(file), 0),
    detail: `${1 + preloads.length} files`,
  },
  largestChunk: { bytes: chunks[0].gzip, detail: `assets/${chunks[0].name}` },
  css: { bytes: styles.reduce((sum, file) => sum + gz(file), 0), detail: `${styles.length} files` },
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, v.bytes])), null, 2));
  process.exit(0);
}

const budget = JSON.parse(readFileSync(budgetPath, 'utf8')).gzipBytes;
let failed = false;
console.log('Bundle size (gzip) against bundle-budget.json');
for (const [key, { bytes, detail }] of Object.entries(actual)) {
  const limit = budget[key];
  if (typeof limit !== 'number') {
    console.error(`  ${key}: no budget set in bundle-budget.json`);
    failed = true;
    continue;
  }
  const ok = bytes <= limit;
  failed ||= !ok;
  console.log(
    `  ${ok ? 'ok  ' : 'OVER'} ${key.padEnd(13)} ${kb(bytes).padStart(9)} / ${kb(limit).padStart(9)}  (${detail})`,
  );
}
console.log(
  '  largest chunks: ' +
    chunks
      .slice(0, 5)
      .map((c) => `${c.name} ${kb(c.gzip)}`)
      .join(', '),
);
if (failed) {
  console.error(
    '\nBundle budget exceeded. Lazy-load the new code (see src/app/routes.tsx) or, if the growth is intended, raise the limit in bundle-budget.json in the same PR.',
  );
  process.exit(1);
}
