import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureFor, loadFixtures, median, parseArgs, summarize } from '../perf/measure.mjs';
import { breaches, distFileFor, serveDist } from '../perf/check-perf.mjs';
import budget from '../perf/budget.json';

describe('measure.mjs', () => {
  it('parses its arguments with sensible defaults', () => {
    expect(parseArgs(['--base', 'http://127.0.0.1:7790/'])).toEqual({
      base: 'http://127.0.0.1:7790',
      paths: ['/', '/search'],
      runs: 1,
      mockApi: false,
      fixtures: null,
      throttle: true,
      out: null,
    });
    const args = parseArgs([
      '--base',
      'https://x.test',
      '--paths',
      '/a, /b',
      '--runs',
      '3',
      '--mock-api',
      '--no-throttle',
      '--out',
      'o.json',
    ]);
    expect(args).toMatchObject({ paths: ['/a', '/b'], runs: 3, mockApi: true, throttle: false, out: 'o.json' });
    expect(() => parseArgs([])).toThrow(/--base/);
    expect(() => parseArgs(['--base', 'x', '--nope'])).toThrow(/Unknown argument/);
  });
  it('answers a mocked API call with the longest matching fixture, else {}', () => {
    const fixtures = loadFixtures('scripts/perf/fixtures/index.json');
    expect(Object.keys(fixtures)).toContain('/public/stats');
    expect(JSON.parse(fixtureFor('http://x/api/public/stats', fixtures))).toHaveProperty('listed');
    expect(JSON.parse(fixtureFor('http://x/api/public/talent?location=Mumbai&limit=6', fixtures)).talent).toHaveLength(
      6,
    );
    // Every committed talent fixture is a demo account, never a real member.
    expect(JSON.parse(fixtures['/public/talent']).talent.every((p) => p.demo === true)).toBe(true);
    expect(fixtureFor('http://x/api/public/talent/user_1', fixtures)).toBe(fixtures['/public/talent']);
    expect(fixtureFor('http://x/api/jobs', fixtures)).toBe('{}');
    expect(fixtureFor('http://x/api/jobs', null)).toBe('{}');
  });
  it('takes the median and ignores what was not measured', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, undefined])).toBe(5);
    expect(median([])).toBeNull();
  });
  it('summarises one line per page', () => {
    const text = summarize({
      base: 'http://x',
      throttled: true,
      runs: 1,
      pages: [{ path: '/', ttfbMs: 1, fcpMs: 2, lcpMs: 3, cls: 0, requests: 4, transferredKB: 5, lcpElement: 'img' }],
    });
    expect(text).toContain('http://x (throttled phone, 1 run(s))');
    expect(text).toContain('/          TTFB 1 ms  FCP 2 ms  LCP 3 ms  CLS 0  4 requests  5 kB  (LCP: img)');
  });
});

describe('check-perf.mjs', () => {
  it('ships a budget for the home and search pages with the limits the plan set', () => {
    expect(budget.paths).toEqual(['/', '/search']);
    expect(budget.limits.requests).toBeLessThanOrEqual(40);
    expect(budget.limits.transferredKB).toBeLessThanOrEqual(300);
    expect(budget.limits.lcpMs).toBeLessThanOrEqual(3000); // CI gate; 2500 is the production target (budget.json note)
    expect(budget.note.length).toBeGreaterThan(50);
  });
  it('names every budget line a page breaks, and nothing for a page within budget', () => {
    const limits = { requests: 40, transferredKB: 300, lcpMs: 2500, cls: 0.1 };
    expect(breaches({ path: '/', requests: 40, transferredKB: 300, lcpMs: 2500, cls: 0.1 }, limits)).toEqual([]);
    expect(breaches({ path: '/', requests: 41, transferredKB: 300.1, lcpMs: 2501, cls: 0.11 }, limits)).toEqual([
      '/: 41 requests (budget 40)',
      '/: 300.1 kB transferred (budget 300 kB)',
      '/: LCP 2501 ms (budget 2500 ms)',
      '/: CLS 0.11 (budget 0.1)',
    ]);
    // A page that never produced an LCP entry is a failure, not a pass.
    expect(breaches({ path: '/search', requests: 1, transferredKB: 1, lcpMs: null, cls: 0 }, limits)).toEqual([
      '/search: LCP not measured ms (budget 2500 ms)',
    ]);
  });

  describe('the dist server', () => {
    let dir;
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
    const makeDist = () => {
      dir = mkdtempSync(join(tmpdir(), 'perf-dist-'));
      mkdirSync(join(dir, 'assets'));
      mkdirSync(join(dir, 'pricing'));
      writeFileSync(join(dir, 'index.html'), '<!doctype html><title>home</title>');
      writeFileSync(join(dir, 'app-shell.html'), '<!doctype html><title>shell</title>');
      writeFileSync(join(dir, 'pricing', 'index.html'), '<!doctype html><title>pricing</title>');
      writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)');
      return dir;
    };
    it('serves files, prerendered heads and the app shell the way vercel.json routes them', () => {
      const dist = makeDist();
      expect(distFileFor('/', dist)).toBe(join(dist, 'index.html'));
      expect(distFileFor('/pricing', dist)).toBe(join(dist, 'pricing', 'index.html'));
      expect(distFileFor('/assets/a.js?v=1', dist)).toBe(join(dist, 'assets', 'a.js'));
      expect(distFileFor('/search', dist)).toBe(join(dist, 'app-shell.html'));
      expect(distFileFor('/professionals/abc', dist)).toBe(join(dist, 'app-shell.html'));
      expect(distFileFor('/../etc/passwd', dist)).toBe(join(dist, 'app-shell.html'));
    });
    it('gzips text for clients that accept it and marks assets immutable', async () => {
      const dist = makeDist();
      const { server, origin } = await serveDist(0, dist);
      try {
        const asset = await fetch(`${origin}/assets/a.js`, { headers: { 'accept-encoding': 'gzip' } });
        expect(asset.headers.get('content-type')).toBe('text/javascript');
        expect(asset.headers.get('cache-control')).toContain('immutable');
        expect(asset.headers.get('content-encoding')).toBe('gzip');
        expect(await asset.text()).toBe('console.log(1)');
        const plain = await fetch(`${origin}/`, { headers: { 'accept-encoding': 'identity' } });
        expect(plain.headers.get('content-encoding')).toBeNull();
        expect(await plain.text()).toContain('home');
        const shell = await fetch(`${origin}/search`);
        expect(await shell.text()).toContain('shell');
      } finally {
        server.close();
      }
    });
  });
});
