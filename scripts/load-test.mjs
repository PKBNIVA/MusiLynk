#!/usr/bin/env node
// Small HTTP load test for the MusiLynk API. No dependencies: Node 22's fetch keeps
// connections alive, and N concurrent loops per scenario approximate N active visitors.
//
//   node scripts/load-test.mjs --base http://127.0.0.1:3000/api \
//     [--duration 20] [--concurrency 10] [--only search,jobs] [--markdown]
//
// Scenarios: search, job listing (first page, next page and filtered), public talent list and profiles,
// public acts, and an authenticated inbox (conversation list + one thread). The inbox
// needs LOAD_EMAIL and LOAD_PASSWORD (any account with conversations, e.g. one from
// `bin/rails synthetic_qa:seed BATCH=demo-load SYNTHETIC_QA_PASSWORD=...`); without them it
// is skipped. Never point this at production without the owner's go-ahead: search is
// rate limited per IP, and against a local server the script spreads requests over
// documentation-range IPs (X-Forwarded-For) so the limiter does not skew the numbers.
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const base = option('base', process.env.LOAD_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const duration = Number(option('duration', 20)) * 1000;
const concurrency = Number(option('concurrency', 10));
const only = option('only', '').split(',').filter(Boolean);
const markdown = args.includes('--markdown');
const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(base);

const SEARCH_TERMS = [
  'vocalist',
  'guitar',
  'sound engineer',
  'wedding',
  'mumbai',
  'jazz',
  'producer',
  'tour',
  'drummer',
  'bollywood',
];
let ipCounter = 0;
const headersFor = (extra = {}) => {
  const headers = { accept: 'application/json', 'accept-encoding': 'gzip', ...extra };
  // 203.0.113.0/24 is reserved for documentation, so it can never be a real visitor.
  if (local) headers['x-forwarded-for'] = `203.0.113.${(ipCounter++ % 250) + 1}`;
  return headers;
};

async function request(path, extra) {
  const started = performance.now();
  const response = await fetch(base + path, { headers: headersFor(extra) });
  const body = await response.arrayBuffer();
  return {
    ms: performance.now() - started,
    status: response.status,
    bytes: body.byteLength,
    timing: response.headers.get('server-timing'),
    json: () => JSON.parse(Buffer.from(body).toString('utf8')),
  };
}

async function login() {
  if (!process.env.LOAD_EMAIL || !process.env.LOAD_PASSWORD) return null;
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: headersFor({ 'content-type': 'application/json' }),
    body: JSON.stringify({ email: process.env.LOAD_EMAIL, password: process.env.LOAD_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed with ${response.status}`);
  return (await response.json()).accessToken;
}

async function discover(token) {
  const talent = (await request('/public/talent')).json().talent || [];
  const acts = (await request('/public/acts')).json().acts || [];
  // The job list is paged; the cursor of the first page drives the "next page" scenario.
  const jobsCursor = (await request('/jobs')).json().nextCursor || null;
  let conversation = null;
  if (token) {
    const conversations =
      (await request('/conversations', { authorization: `Bearer ${token}` })).json().conversations || [];
    conversation = conversations[0]?.id || null;
  }
  return {
    talentIds: talent.map((t) => t.id).slice(0, 50),
    actIds: acts.map((a) => a.id).slice(0, 20),
    conversation,
    jobsCursor,
  };
}

function scenarios(ctx, token) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const auth = token ? { authorization: `Bearer ${token}` } : null;
  const all = [
    { name: 'search', path: () => `/search?q=${encodeURIComponent(pick(SEARCH_TERMS))}` },
    { name: 'jobs (all)', path: () => '/jobs' },
    {
      name: 'jobs (next page)',
      path: () => `/jobs?cursor=${encodeURIComponent(ctx.jobsCursor)}`,
      skip: !ctx.jobsCursor,
    },
    { name: 'jobs (filtered)', path: () => `/jobs?q=${encodeURIComponent(pick(SEARCH_TERMS))}` },
    { name: 'public talent list', path: () => '/public/talent' },
    { name: 'public profile', path: () => `/public/talent/${pick(ctx.talentIds)}`, skip: ctx.talentIds.length === 0 },
    { name: 'public acts', path: () => '/public/acts' },
    { name: 'inbox', path: () => '/conversations', headers: auth, skip: !auth },
    {
      name: 'inbox thread',
      path: () => `/conversations/${ctx.conversation}/messages`,
      headers: auth,
      skip: !auth || !ctx.conversation,
    },
  ];
  return all.filter((s) => !s.skip && (only.length === 0 || only.some((o) => s.name.startsWith(o))));
}

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN;

async function run(scenario) {
  const samples = [];
  const errors = new Map();
  let bytes = 0;
  let dbTotal = 0;
  const deadline = performance.now() + duration;
  const started = performance.now();
  const worker = async () => {
    while (performance.now() < deadline) {
      try {
        const result = await request(scenario.path(), scenario.headers || undefined);
        if (result.status >= 400) errors.set(result.status, (errors.get(result.status) || 0) + 1);
        samples.push(result.ms);
        bytes += result.bytes;
        dbTotal += Number(/db;dur=([\d.]+)/.exec(result.timing || '')?.[1] || 0);
      } catch (error) {
        errors.set(error.code || error.name, (errors.get(error.code || error.name) || 0) + 1);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - started) / 1000;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name: scenario.name,
    requests: samples.length,
    rps: samples.length / elapsed,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    dbAvg: samples.length ? dbTotal / samples.length : NaN,
    kbAvg: samples.length ? bytes / samples.length / 1000 : NaN,
    errors: [...errors].map(([k, v]) => `${k}×${v}`).join(' ') || '0',
  };
}

const token = await login();
const ctx = await discover(token);
const list = scenarios(ctx, token);
if (!token && (only.length === 0 || only.includes('inbox')))
  console.error('LOAD_EMAIL/LOAD_PASSWORD not set: skipping the inbox scenarios.');
console.error(
  `Load test: ${base}, ${concurrency} concurrent, ${duration / 1000}s per scenario, ${list.length} scenarios`,
);

const results = [];
for (const scenario of list) {
  // A short warm-up so the first-request costs (connection, caches) are not measured.
  for (let i = 0; i < 3; i += 1) await request(scenario.path(), scenario.headers || undefined).catch(() => undefined);
  const result = await run(scenario);
  results.push(result);
  console.error(`  ${result.name}: ${result.requests} requests, p95 ${result.p95.toFixed(0)} ms`);
}

const fmt = (n, digits = 0) => (Number.isFinite(n) ? n.toFixed(digits) : '-');
if (markdown) {
  console.log('| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Avg DB ms | Avg KB (JSON) | Errors |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const r of results)
    console.log(
      `| ${r.name} | ${r.requests} | ${fmt(r.rps, 1)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.dbAvg, 1)} | ${fmt(r.kbAvg, 1)} | ${r.errors} |`,
    );
} else {
  console.table(
    results.map((r) => ({
      scenario: r.name,
      requests: r.requests,
      'req/s': fmt(r.rps, 1),
      p50: fmt(r.p50),
      p95: fmt(r.p95),
      p99: fmt(r.p99),
      'db ms': fmt(r.dbAvg, 1),
      KB: fmt(r.kbAvg, 1),
      errors: r.errors,
    })),
  );
}
process.exitCode = results.some((r) => r.errors !== '0') ? 1 : 0;
