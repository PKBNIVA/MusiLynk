#!/usr/bin/env node
// Measures the loading performance of a few pages on a throttled phone and prints JSON.
//
//   node scripts/perf/measure.mjs --base https://musilynk.vercel.app
//   node scripts/perf/measure.mjs --base http://127.0.0.1:7790 --mock-api --paths /,/search --runs 3
//
// Profile (Lighthouse's "mobile, slow 4G"): a 390x844 phone at 3x density, CPU slowed 4x,
// 1.6 Mbps down / 750 kbps up with 150 ms of round-trip latency, applied through the Chrome
// DevTools Protocol. Per page: TTFB, FCP, LCP (and its element), CLS, request count and bytes
// transferred over the wire (CDP Network.loadingFinished encodedDataLength, headers included),
// from a cold cache every run. With --runs N the median of each number is reported.
//
// --mock-api answers every /api/* call with `{}` (what the Playwright specs do), so the number
// measures the front end alone and does not depend on a live backend; --fixtures <index.json> maps
// API paths to JSON files to answer with instead (scripts/perf/fixtures, so the home page renders
// its real sections). --no-throttle measures the unthrottled page. --out <file> also writes the
// JSON there. Human summary goes to stderr.
//
// Needs Chromium from Playwright (`npx playwright install chromium-headless-shell`).
// `npm run check:perf` (scripts/perf/check-perf.mjs) runs this against the local build and
// fails the build when scripts/perf/budget.json is exceeded.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

export const PROFILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  cpuSlowdown: 4,
  // Lighthouse's mobile throttling: 1.6 Mbps down, 750 kbps up, 150 ms RTT.
  downloadBytesPerSecond: (1.6 * 1024 * 1024) / 8,
  uploadBytesPerSecond: (750 * 1024) / 8,
  latencyMs: 150,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
};

/** How long after the network goes quiet the page is left alone so LCP and lazy chunks settle. */
const SETTLE_MS = 2_000;
const NAVIGATION_TIMEOUT_MS = 60_000;

export function parseArgs(argv) {
  const args = {
    paths: ['/', '/search'],
    runs: 1,
    mockApi: false,
    fixtures: null,
    throttle: true,
    out: null,
    base: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--base') args.base = next();
    else if (arg === '--paths')
      args.paths = next()
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    else if (arg === '--runs') args.runs = Math.max(1, Number(next()) || 1);
    else if (arg === '--mock-api') args.mockApi = true;
    else if (arg === '--fixtures') args.fixtures = loadFixtures(next());
    else if (arg === '--no-throttle') args.throttle = false;
    else if (arg === '--out') args.out = next();
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!args.base) throw new Error('--base <origin> is required');
  args.base = args.base.replace(/\/+$/, '');
  return args;
}

/** `{ "/public/stats": "public-stats.json" }` next to the index -> `{ "/public/stats": "<its contents>" }`. */
export function loadFixtures(indexPath) {
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const dir = dirname(resolve(indexPath));
  return Object.fromEntries(
    Object.entries(index).map(([path, file]) => [path, readFileSync(resolve(dir, file), 'utf8')]),
  );
}

/** The fixture body for an API URL: the longest fixture path the request path starts with, else `{}`. */
export function fixtureFor(url, fixtures) {
  const path = new URL(url).pathname.replace(/^.*?\/api(?=\/)/, '');
  const match = Object.keys(fixtures || {})
    .filter((key) => path === key || path.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return match ? fixtures[match] : '{}';
}

/** Median of a list of numbers (null entries ignored); null when nothing was measured. */
export function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

// Runs in the page before any script: collects paint, LCP and layout-shift entries.
function observeVitals() {
  const m = { fcp: null, lcp: null, lcpElement: null, cls: 0 };
  window.__perfMetrics = m;
  const observe = (type, onEntry) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
    } catch {
      /* unsupported entry type */
    }
  };
  observe('paint', (e) => {
    if (e.name === 'first-contentful-paint') m.fcp = e.startTime;
  });
  observe('largest-contentful-paint', (e) => {
    m.lcp = e.startTime;
    const el = e.element;
    m.lcpElement = el
      ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${e.url ? ' ' + e.url.replace(/^https?:\/\/[^/]+/, '') : ''}`
      : null;
  });
  observe('layout-shift', (e) => {
    if (!e.hadRecentInput) m.cls += e.value;
  });
}

async function measureOnce(browser, url, options) {
  const context = await browser.newContext({
    viewport: PROFILE.viewport,
    deviceScaleFactor: PROFILE.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: PROFILE.userAgent,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    if (options.mockApi || options.fixtures) {
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: fixtureFor(route.request().url(), options.fixtures),
        }),
      );
    }
    const requests = new Map();
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (options.throttle) {
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: PROFILE.latencyMs,
        downloadThroughput: PROFILE.downloadBytesPerSecond,
        uploadThroughput: PROFILE.uploadBytesPerSecond,
      });
      await session.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.cpuSlowdown });
    }
    session.on('Network.requestWillBeSent', (e) => {
      if (/^data:/.test(e.request.url)) return;
      requests.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0, finished: false });
    });
    session.on('Network.loadingFinished', (e) => {
      const r = requests.get(e.requestId);
      if (r) {
        r.bytes = e.encodedDataLength;
        r.finished = true;
      }
    });
    session.on('Network.loadingFailed', (e) => {
      const r = requests.get(e.requestId);
      if (r) r.finished = true;
    });
    await page.addInitScript(observeVitals);

    await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    const inPage = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        ttfb: nav ? nav.responseStart : null,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        load: nav ? nav.loadEventEnd : null,
        ...window.__perfMetrics,
      };
    });
    const list = [...requests.values()];
    const byType = {};
    for (const r of list) {
      const key = (r.type || 'Other').toLowerCase();
      byType[key] = byType[key] || { requests: 0, bytes: 0 };
      byType[key].requests += 1;
      byType[key].bytes += r.bytes;
    }
    return {
      ...inPage,
      requests: list.length,
      transferredBytes: list.reduce((sum, r) => sum + r.bytes, 0),
      byType,
      urls: list.map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), bytes: r.bytes })),
    };
  } finally {
    await context.close();
  }
}

const round = (n, digits = 0) => (n === null || n === undefined ? null : Number(n.toFixed(digits)));

export async function measure(args) {
  const browser = await chromium.launch();
  const pages = [];
  try {
    for (const path of args.paths) {
      const url = `${args.base}${path}`;
      const runs = [];
      for (let i = 0; i < args.runs; i += 1) runs.push(await measureOnce(browser, url, args));
      const pick = (key) => median(runs.map((r) => r[key]));
      // The request list from the run whose transfer is the median, so URLs and bytes agree.
      const representative = runs.slice().sort((a, b) => a.transferredBytes - b.transferredBytes)[
        Math.floor((runs.length - 1) / 2)
      ];
      pages.push({
        path,
        url,
        ttfbMs: round(pick('ttfb')),
        fcpMs: round(pick('fcp')),
        lcpMs: round(pick('lcp')),
        lcpElement: representative.lcpElement,
        cls: round(pick('cls'), 3),
        domContentLoadedMs: round(pick('domContentLoaded')),
        loadMs: round(pick('load')),
        requests: round(pick('requests')),
        transferredKB: round(pick('transferredBytes') / 1024, 1),
        byType: Object.fromEntries(
          Object.entries(representative.byType).map(([k, v]) => [
            k,
            { requests: v.requests, kB: round(v.bytes / 1024, 1) },
          ]),
        ),
        urls: representative.urls,
      });
    }
  } finally {
    await browser.close();
  }
  return {
    measuredAt: new Date().toISOString(),
    base: args.base,
    runs: args.runs,
    mockApi: Boolean(args.mockApi || args.fixtures),
    fixtures: args.fixtures ? Object.keys(args.fixtures) : [],
    throttled: args.throttle,
    profile: args.throttle
      ? {
          viewport: `${PROFILE.viewport.width}x${PROFILE.viewport.height}@${PROFILE.deviceScaleFactor}x`,
          cpuSlowdown: PROFILE.cpuSlowdown,
          downloadKbps: Math.round((PROFILE.downloadBytesPerSecond * 8) / 1024),
          uploadKbps: Math.round((PROFILE.uploadBytesPerSecond * 8) / 1024),
          latencyMs: PROFILE.latencyMs,
        }
      : { viewport: `${PROFILE.viewport.width}x${PROFILE.viewport.height}@${PROFILE.deviceScaleFactor}x` },
    pages,
  };
}

export function summarize(result) {
  const lines = [`${result.base} (${result.throttled ? 'throttled phone' : 'unthrottled'}, ${result.runs} run(s))`];
  for (const p of result.pages) {
    lines.push(
      `${p.path.padEnd(10)} TTFB ${p.ttfbMs} ms  FCP ${p.fcpMs} ms  LCP ${p.lcpMs} ms  CLS ${p.cls}  ` +
        `${p.requests} requests  ${p.transferredKB} kB  (LCP: ${p.lcpElement ?? 'n/a'})`,
    );
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = await measure(args);
  process.stderr.write(summarize(result) + '\n');
  const json = JSON.stringify(result, null, 2);
  if (args.out) writeFileSync(args.out, json);
  process.stdout.write(json + '\n');
}
