import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readSeoPages } from '../prerender-heads.mjs';

// vercel.json is the production router: a wrong rewrite 404s real pages, and a missing one lets unknown
// URLs return 200 (a soft 404). These tests pin the contract without needing a deployment.
const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));

/** The SPA rewrites (no `has` condition), compiled the way Vercel's path-to-regexp does for these shapes. */
const spaRules = config.rewrites
  .filter((rule) => !rule.has && (rule.destination === '/index.html' || rule.destination === '/app-shell.html'))
  .map((rule) => new RegExp(`^${rule.source}$`));
const servedAsApp = (path) => spaRules.some((re) => re.test(path));

describe('vercel.json SPA rewrites', () => {
  it('serve the app for every route the public build declares', () => {
    const source = readFileSync(resolve(root, 'src/app/routes.tsx'), 'utf8');
    // Public build only: stop before the separate admin site's route table.
    const publicBlock = source.slice(0, source.indexOf('// The separate admin site'));
    const paths = new Set();
    for (const match of publicBlock.matchAll(/(?:path:\s*|\[\s*)'(\/[^']*)'/g)) paths.add(match[1]);
    expect(paths.size).toBeGreaterThan(30);
    const missing = [...paths]
      .map((path) => path.replace(/:[a-zA-Z]+/g, 'sample'))
      // hire and rates are listed role by role and city by city, so use real slugs.
      .map((path) =>
        path.replace(/^\/hire\/sample\/sample$/, '/hire/drummer/mumbai').replace(/^\/rates\/sample$/, '/rates/mumbai'),
      )
      .filter((path) => !servedAsApp(path));
    expect(missing).toEqual([]);
  });

  it('return a real 404 for unknown URLs, missing assets and unknown role or city combinations', () => {
    for (const path of [
      '/nonexistent',
      '/admin',
      '/assets/missing.js',
      '/hire/violin/mumbai',
      '/hire/drummer/atlantis',
      '/hire/drummer',
      '/rates/nowhere',
      '/index.htm',
    ])
      expect(servedAsApp(path), path).toBe(false);
  });

  it('serve the app for the home page and for deep links into record pages', () => {
    for (const path of [
      '/',
      '/pricing',
      '/professionals/user_1',
      '/opportunities/job_1',
      '/acts/act_1',
      '/p/some-slug',
      '/jobseeker/profile',
      '/stage/posts/1',
    ])
      expect(servedAsApp(path), path).toBe(true);
  });

  it('list exactly the roles and cities in backend/config/seo_pages.yml', () => {
    const { roles, cities } = readSeoPages(readFileSync(resolve(root, 'backend/config/seo_pages.yml'), 'utf8'));
    for (const [role] of roles)
      for (const [city] of cities) expect(servedAsApp(`/hire/${role}/${city}`), `${role}/${city}`).toBe(true);
    for (const [city] of cities) expect(servedAsApp(`/rates/${city}`), city).toBe(true);
    const hireRule = config.rewrites.find((rule) => rule.source.startsWith('/hire/'));
    const listed = hireRule.source.match(/^\/hire\/\(([^)]*)\)\/\(([^)]*)\)$/);
    expect(listed[1].split('|')).toEqual(roles.map(([slug]) => slug));
    expect(listed[2].split('|')).toEqual(cities.map(([slug]) => slug));
  });
});

describe('vercel.json crawler routing and headers', () => {
  const crawlerRules = config.rewrites.filter((rule) => rule.has);
  const agentFor = (source) => crawlerRules.find((rule) => rule.source === source).has[0].value;

  it('sends Googlebot to the server-rendered share page for every record type with structured data', () => {
    for (const source of ['/opportunities/:id', '/professionals/:id', '/acts/:id', '/p/:slug']) {
      expect(
        new RegExp(agentFor(source)).test('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
        source,
      ).toBe(true);
      expect(new RegExp(agentFor(source)).test('facebookexternalhit/1.1'), source).toBe(true);
      expect(new RegExp(agentFor(source)).test('Mozilla/5.0 (Windows NT 10.0) Chrome/124 Safari/537.36'), source).toBe(
        false,
      );
    }
  });

  it('redirects a trailing slash and /index.html to the canonical URL', () => {
    expect(config.trailingSlash).toBe(false);
    expect(config.redirects).toContainEqual({ source: '/index.html', destination: '/', permanent: true });
  });

  it('marks signed-in and account-flow areas noindex via X-Robots-Tag', () => {
    const rule = config.headers.find((entry) => entry.headers.some((header) => header.key === 'X-Robots-Tag'));
    const re = new RegExp(`^${rule.source}$`);
    for (const path of ['/jobseeker/profile', '/employer', '/auth/jobseeker', '/search', '/reset-password'])
      expect(re.test(path), path).toBe(true);
    for (const path of ['/', '/pricing', '/hire/drummer/mumbai', '/professionals/user_1'])
      expect(re.test(path), path).toBe(false);
  });

  it('never marks an asset immutable unless it is a hashed build file', () => {
    const immutable = config.headers.filter((entry) => entry.headers.some((header) => /immutable/.test(header.value)));
    expect(immutable.map((entry) => entry.source)).toEqual(['/assets/(.*)']);
  });
});

describe('public/robots.txt and the web manifest', () => {
  const robots = readFileSync(resolve(root, 'public/robots.txt'), 'utf8');
  const disallowed = robots
    .split('\n')
    .filter((line) => line.startsWith('Disallow:'))
    .map((line) => line.slice(9).trim());

  it('disallows the signed-in areas, account flows and the internal shell files', () => {
    for (const path of [
      '/admin',
      '/employer',
      '/jobseeker',
      '/auth/',
      '/search',
      '/forgot-password',
      '/app-shell.html',
      '/404.html',
    ])
      expect(disallowed, path).toContain(path);
    expect(robots).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  });

  it('never blocks a page the sitemap lists or the OG image function', () => {
    const publicPaths = [
      '/',
      '/music-jobs',
      '/music-professionals',
      '/book-music',
      '/pricing',
      '/guide',
      '/hire/drummer/mumbai',
      '/rates/mumbai',
      '/professionals/user_1',
      '/opportunities/job_1',
      '/acts/act_1',
      '/api/og/professional/user_1.png',
    ];
    for (const path of publicPaths)
      expect(
        disallowed.some((rule) => path.startsWith(rule)),
        path,
      ).toBe(false);
  });

  it('has a manifest with an id, language and the two install icons', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.id).toBe('/');
    expect(manifest.lang).toBe('en-IN');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });
});
