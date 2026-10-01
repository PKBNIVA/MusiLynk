import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Core Web Vitals maths --------------------------------------------------------------
const vitals = await import('../src/app/lib/webVitals.ts');

assert.equal(vitals.rateVital('LCP', 2500), 'good');
assert.equal(vitals.rateVital('LCP', 2501), 'needs-improvement');
assert.equal(vitals.rateVital('LCP', 4001), 'poor');
assert.equal(vitals.rateVital('INP', 180), 'good');
assert.equal(vitals.rateVital('INP', 600), 'poor');
assert.equal(vitals.rateVital('CLS', 0.05), 'good');
assert.equal(vitals.rateVital('CLS', 0.2), 'needs-improvement');

const shift = (startTime, value, hadRecentInput = false) => ({ startTime, value, hadRecentInput });
assert.equal(vitals.clsFromShifts([]), 0);
// Two shifts 500 ms apart share a window; a shift 2 s later starts a new one.
assert.equal(vitals.clsFromShifts([shift(0, 0.1), shift(500, 0.05), shift(2600, 0.12)]).toFixed(2), '0.15');
// A window lasts at most 5 s even when shifts keep coming.
assert.equal(
  vitals.clsFromShifts([0, 900, 1800, 2700, 3600, 4500, 5400].map((t) => shift(t, 0.02))).toFixed(2),
  '0.12',
);
// Shifts caused by the visitor's own input do not count.
assert.equal(vitals.clsFromShifts([shift(0, 0.5, true), shift(100, 0.01)]), 0.01);

assert.equal(vitals.inpFromInteractions([]), null);
assert.equal(vitals.inpFromInteractions([40, 300, 120]), 300, 'few interactions: the slowest one');
const many = Array.from({ length: 120 }, (_, i) => i + 1); // 1..120
assert.equal(vitals.inpFromInteractions(many), 118, 'one outlier ignored per 50 interactions');

// --- Collection in a (simulated) browser ------------------------------------------------
{
  const observers = [];
  class FakeObserver {
    static supportedEntryTypes = ['largest-contentful-paint', 'layout-shift', 'event', 'first-input'];
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(options) {
      this.type = options.type;
    }
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      return [];
    }
    emit(entries) {
      this.callback({ getEntries: () => entries.map((e) => ({ entryType: this.type, ...e })) });
    }
  }
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  Object.assign(globalThis, { PerformanceObserver: FakeObserver, document: doc, window: win });

  const reported = [];
  vitals.startWebVitals((vital) => reported.push(vital));
  const of = (type) => observers.find((o) => o.type === type);
  of('largest-contentful-paint').emit([{ startTime: 1200 }, { startTime: 3100 }]);
  of('layout-shift').emit([{ startTime: 10, value: 0.3, hadRecentInput: false }]);
  of('event').emit([
    { interactionId: 7, duration: 90 },
    { interactionId: 7, duration: 260 },
    { interactionId: 0, duration: 999 },
  ]);
  win.dispatchEvent(new Event('pointerdown'));
  of('largest-contentful-paint').emit([{ startTime: 9000 }]); // after input: ignored
  assert.equal(reported.length, 0, 'nothing is sent while the page is visible');

  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(reported, [
    { name: 'LCP', value: 3100, rating: 'needs-improvement' },
    { name: 'INP', value: 260, rating: 'needs-improvement' },
    { name: 'CLS', value: 0.3, rating: 'poor' },
  ]);
  assert.ok(
    observers.every((o) => o.disconnected),
    'observers stop after reporting',
  );
  win.dispatchEvent(new Event('pagehide'));
  assert.equal(reported.length, 3, 'each vital is reported once per page view');
  delete globalThis.PerformanceObserver;
  delete globalThis.document;
  delete globalThis.window;
}

// --- Monitoring wiring ----------------------------------------------------------------
const monitoring = await import('../src/app/lib/monitoring.ts');
assert.equal(monitoring.routeTemplate('/professionals/jane-doe'), '/professionals/:id');
assert.equal(monitoring.routeTemplate('/employer/jobs/42?tab=applicants'), '/employer/jobs/:id');
assert.equal(monitoring.routeTemplate('/opportunities/8f14e45f-ceea-4c3d-9a1b-0123456789ab'), '/opportunities/:id');
assert.equal(monitoring.routeTemplate('/jobseeker/messages'), '/jobseeker/messages');
assert.equal(monitoring.routeTemplate('/'), '/');
// Without a DSN nothing is collected or sent.
monitoring.reportWebVital({ name: 'LCP', value: 1000, rating: 'good' }, '/');
assert.equal(monitoring.tracesSampleRate(undefined), monitoring.DEFAULT_TRACES_SAMPLE_RATE);
assert.ok(
  monitoring.DEFAULT_TRACES_SAMPLE_RATE > 0 && monitoring.DEFAULT_TRACES_SAMPLE_RATE <= 0.1,
  'small but non-zero default',
);
assert.equal(monitoring.tracesSampleRate('0'), 0, 'an explicit 0 turns tracing off');
assert.equal(monitoring.tracesSampleRate('0.5'), 0.5);
assert.equal(monitoring.tracesSampleRate('9'), 1);
assert.equal(monitoring.tracesSampleRate('lots'), monitoring.DEFAULT_TRACES_SAMPLE_RATE);

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// --- Entry chunk stays lean (asserted on the production build, `npm run build`) ------------------
// The first paint loads index.html's entry script plus its modulepreload chunks. Sentry, the toast
// library and the confirm dialog must sit in chunks that are NOT part of that set, so they load only
// when needed. Each library is found by a string its own code always contains, so a renamed chunk
// or a moved import cannot fool the check.
{
  const dist = new URL('../dist/', import.meta.url);
  assert.ok(existsSync(new URL('index.html', dist)), 'dist/ is missing: run `npm run build` before this test');
  const html = readFileSync(new URL('index.html', dist), 'utf8');
  const initial = new Set(
    [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]),
  );
  assert.ok(initial.size >= 2, `index.html should load an entry chunk and its preloads, found ${[...initial]}`);
  const chunks = readdirSync(new URL('assets/', dist)).filter((name) => name.endsWith('.js'));
  const holders = (marker) =>
    chunks
      .filter((name) => readFileSync(new URL(`assets/${name}`, dist), 'utf8').includes(marker))
      .map((n) => `assets/${n}`);

  for (const [library, marker] of [
    ['Sentry', '__SENTRY__'],
    ['the toast library (sonner)', 'data-sonner-toast'],
    ['the confirm dialog (Radix alert dialog)', 'alertdialog'],
  ]) {
    const where = holders(marker);
    assert.ok(where.length > 0, `${library} was not found in any chunk: update its marker in this test`);
    const eager = where.filter((file) => initial.has(file));
    assert.deepEqual(eager, [], `${library} must load on demand, but the first paint loads ${eager}`);
  }
}

// --- Bundle budget script ---------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'verse-budget-'));
try {
  mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
  writeFileSync(
    join(dir, 'dist', 'index.html'),
    '<script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-b.js"><link rel="stylesheet" crossorigin href="/assets/index-c.css">',
  );
  writeFileSync(join(dir, 'dist', 'assets', 'index-a.js'), 'console.log("entry");'.repeat(20));
  writeFileSync(
    join(dir, 'dist', 'assets', 'vendor-b.js'),
    Array.from({ length: 400 }, (_, i) => `var v${i}=${i * 7919};`).join(''),
  );
  writeFileSync(join(dir, 'dist', 'assets', 'lazy-d.js'), 'x');
  writeFileSync(join(dir, 'dist', 'assets', 'index-c.css'), 'body{color:red}');
  const run = (budget) => {
    writeFileSync(join(dir, 'budget.json'), JSON.stringify({ gzipBytes: budget }));
    try {
      return {
        code: 0,
        out: execFileSync(
          'node',
          ['scripts/check-bundle-size.mjs', '--dist', join(dir, 'dist'), '--budget', join(dir, 'budget.json')],
          { encoding: 'utf8', stdio: 'pipe' },
        ),
      };
    } catch (error) {
      return { code: error.status, out: String(error.stdout) + String(error.stderr) };
    }
  };
  const generous = { entryChunk: 10_000, initialJs: 10_000, largestChunk: 10_000, css: 10_000 };
  const ok = run(generous);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /largestChunk[\s\S]*assets\/vendor-b\.js/);
  const over = run({ ...generous, initialJs: 50 });
  assert.equal(over.code, 1, 'an over-budget build fails');
  assert.match(over.out, /OVER initialJs/);
  const missing = run({ entryChunk: 10_000 });
  assert.equal(missing.code, 1, 'every measurement needs a budget');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
assert.ok(JSON.parse(read('../bundle-budget.json')).gzipBytes.entryChunk > 0, 'the committed budget exists');

console.log('frontend performance smoke: ok');
