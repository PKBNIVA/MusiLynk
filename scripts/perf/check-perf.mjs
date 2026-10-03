#!/usr/bin/env node
// The speed gate: `npm run check:perf`. Serves dist/ on a private port, measures the home and search
// pages on the throttled phone profile of measure.mjs (API calls answered from scripts/perf/fixtures), and
// fails when any page breaches scripts/perf/budget.json. Runs in the frontend CI job after
// `npm run build`; `--build` runs the build first, `--runs N` takes the median of N loads,
// `--out <file>` keeps the full measurement. Raise a budget only in a PR whose purpose is that
// growth, with the reason written into budget.json.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures, measure, summarize } from './measure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = join(root, 'dist');
const budget = JSON.parse(readFileSync(join(root, 'scripts/perf/budget.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

/** The file dist/ would serve for a URL path, mirroring the vercel.json rewrites (prerendered head, else the shell). */
export function distFileFor(urlPath, dir = distDir) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const direct = join(dir, clean);
  if (direct.startsWith(dir) && existsSync(direct) && statSync(direct).isFile()) return direct;
  const prerendered = join(dir, clean, 'index.html');
  if (prerendered.startsWith(dir) && existsSync(prerendered)) return prerendered;
  const shell = join(dir, 'app-shell.html');
  return existsSync(shell) ? shell : join(dir, 'index.html');
}

/** Serves dist/ (static files, immutable /assets, the SPA shell for everything else) on 127.0.0.1. */
export function serveDist(port = 0, dir = distDir) {
  const server = createServer((req, res) => {
    const file = distFileFor(req.url || '/', dir);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    let body;
    try {
      body = readFileSync(file);
    } catch {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', type);
    if (file.includes(`${dir}/assets/`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Text is gzipped like Vercel serves it, so transferred bytes compare with production.
    if (COMPRESSIBLE.has(extname(file)) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      body = gzipSync(body, { level: 9 });
    }
    res.end(body);
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolveServer({ server, origin: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

/** Every budget line a page breaks, as human sentences; empty when the page is within budget. */
export function breaches(page, limits) {
  const out = [];
  if (limits.requests !== undefined && page.requests > limits.requests)
    out.push(`${page.path}: ${page.requests} requests (budget ${limits.requests})`);
  if (limits.transferredKB !== undefined && page.transferredKB > limits.transferredKB)
    out.push(`${page.path}: ${page.transferredKB} kB transferred (budget ${limits.transferredKB} kB)`);
  if (limits.lcpMs !== undefined && (page.lcpMs === null || page.lcpMs > limits.lcpMs))
    out.push(`${page.path}: LCP ${page.lcpMs ?? 'not measured'} ms (budget ${limits.lcpMs} ms)`);
  if (limits.cls !== undefined && page.cls > limits.cls)
    out.push(`${page.path}: CLS ${page.cls} (budget ${limits.cls})`);
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const started = Date.now();
  if (flag('--build')) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('check-perf: dist/index.html is missing; run `npm run build` first (or pass --build).');
    process.exit(1);
  }
  const port = Number(process.env.PERF_PORT || 0);
  const { server, origin } = await serveDist(port);
  let result;
  try {
    result = await measure({
      base: origin,
      paths: budget.paths,
      runs: Math.max(1, Number(value('--runs', budget.runs || 1)) || 1),
      mockApi: true,
      fixtures: loadFixtures(join(root, 'scripts/perf/fixtures/index.json')),
      throttle: true,
      out: null,
    });
  } finally {
    server.close();
  }
  console.log(summarize(result));
  const out = value('--out', null);
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(result, null, 2));
  const failures = result.pages.flatMap((page) => breaches(page, budget.limits));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failures.length) {
    console.error(`\ncheck-perf: over budget (${seconds} s)\n  ` + failures.join('\n  '));
    console.error(`Budgets live in scripts/perf/budget.json: ${budget.note}`);
    process.exit(1);
  }
  console.log(`check-perf: every page within budget (${seconds} s).`);
}
