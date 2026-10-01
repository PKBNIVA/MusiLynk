import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  readSeoPages,
  seoPageRoutes,
  seoPageBreadcrumbs,
  render,
  renderNotFound,
  apiPreconnect,
} from '../prerender-heads.mjs';

const scriptPath = resolve(process.cwd(), 'scripts/prerender-heads.mjs');

const FAKE_INDEX = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verse</title>
  <meta name="description" content="default description">
  <meta property="og:title" content="Default og title">
  <meta
    property="og:image"
    content="https://default.example/og-default.png"
  >
  <meta name="twitter:title" content="Default twitter title">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/index-abc.js"></script>
</body>
</html>`;

let dirs = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function makeDist() {
  const dist = mkdtempSync(join(tmpdir(), 'verse-prerender-'));
  dirs.push(dist);
  writeFileSync(join(dist, 'index.html'), FAKE_INDEX);
  writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://example.test/sitemap.xml\n');
  return dist;
}

describe('prerender-heads.mjs', () => {
  it('writes a per-route index.html with the right title, description and canonical', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });

    const html = readFileSync(join(dist, 'pricing', 'index.html'), 'utf8');
    expect(html).toContain('<title>Pricing</title>');
    expect(html).toContain('<link rel="canonical" href="https://verse.example/pricing">');
    expect(html).toContain('<meta property="og:url" content="https://verse.example/pricing">');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
  });

  it('writes the root route to dist/index.html itself', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html).toContain('Hire verified musicians in Mumbai within 24 hours');
    expect(html).toContain('<link rel="canonical" href="https://verse.example/">');
  });

  it('rewrites the robots.txt Sitemap line to the configured base URL', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://verse.example/sitemap.xml');
  });

  it('does nothing when VITE_APP_TARGET=admin', () => {
    const dist = mkdtempSync(join(tmpdir(), 'verse-prerender-admin-'));
    dirs.push(dist);
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.html'), FAKE_INDEX);
    execFileSync(process.execPath, [scriptPath, dist], { env: { ...process.env, VITE_APP_TARGET: 'admin' } });
    // No pricing/ directory should have been created.
    expect(() => readFileSync(join(dist, 'pricing', 'index.html'), 'utf8')).toThrow();
  });

  it('replaces the document-level og and twitter defaults instead of repeating them', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const html = readFileSync(join(dist, 'pricing', 'index.html'), 'utf8');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html.match(/name="twitter:title"/g)).toHaveLength(1);
    expect(html).not.toContain('Default og title');
    expect(html).not.toContain('default.example');
    expect(render(FAKE_INDEX, '/x', ['T', 'D'])).toContain('<title>T</title>');
  });

  it('writes the photo credits page', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const html = readFileSync(join(dist, 'credits', 'index.html'), 'utf8');
    expect(html).toContain('<title>Photo credits</title>');
    expect(html).toContain('<link rel="canonical" href="https://verse.example/credits">');
  });

  it('writes a head for each of the 12 x 16 hire pages and 16 rates pages, worded like the pages', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const hire = readFileSync(join(dist, 'hire', 'dj', 'pune', 'index.html'), 'utf8');
    expect(hire).toContain('<title>Hire a verified DJ in Pune | Verse</title>');
    expect(hire).toContain('<link rel="canonical" href="https://verse.example/hire/dj/pune">');
    expect(hire).not.toContain('noindex');
    expect(hire).toContain('<div id="root"></div>');
    const rates = readFileSync(join(dist, 'rates', 'goa', 'index.html'), 'utf8');
    expect(rates).toContain('<title>What musicians charge in Goa | Verse</title>');
    // Descriptions are cut at 160 characters, like PageMeta.tsx does.
    for (const match of hire.matchAll(/name="description" content="([^"]*)"/g))
      expect(match[1].length).toBeLessThanOrEqual(160);
  });

  it('reads the fixed role and city lists from backend/config/seo_pages.yml', () => {
    const lists = readSeoPages(readFileSync(resolve(process.cwd(), 'backend/config/seo_pages.yml'), 'utf8'));
    expect(lists.roles).toHaveLength(12);
    expect(lists.cities).toHaveLength(16);
    expect(lists.roles[0]).toEqual(['drummer', 'Drummer']);
    expect(lists.cities[0]).toEqual(['mumbai', 'Mumbai']);
    const routes = seoPageRoutes(lists);
    expect(Object.keys(routes)).toHaveLength(12 * 16 + 16);
    expect(routes['/hire/sound-engineer/kochi'][0]).toBe('Hire a verified sound engineer in Kochi | Verse');
  });

  it('parses a small list and ignores comments and other keys', () => {
    const lists = readSeoPages('# c\nroles:\n  a-b: A b\n\nother:\n  x: y\ncities:\n  pune: Pune\n');
    expect(lists).toEqual({ roles: [['a-b', 'A b']], cities: [['pune', 'Pune']] });
  });

  it('writes 404.html as a noindex copy of the app shell, so unknown URLs are a real 404 that still mounts the SPA', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const html = readFileSync(join(dist, '404.html'), 'utf8');
    expect(html).toContain('<title>Page not found | Verse</title>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
    expect(html).not.toContain('rel="canonical"');
    const shell =
      '<head><title>Verse</title><meta name="robots" content="index, follow"><link rel="canonical" href="https://x.test/"></head>';
    expect(renderNotFound(shell)).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(renderNotFound(shell)).not.toContain('index, follow');
  });

  it('gives every hire and rates page a BreadcrumbList with absolute URLs, marked so the page replaces it', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const html = readFileSync(join(dist, 'hire', 'drummer', 'mumbai', 'index.html'), 'utf8');
    const match = html.match(/<script type="application\/ld\+json" data-page-meta>(.*?)<\/script>/);
    expect(match).not.toBeNull();
    const ld = JSON.parse(match[1]);
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement.map((item) => item.position)).toEqual([1, 2, 3]);
    for (const item of ld.itemListElement) expect(item.item).toMatch(/^https:\/\/verse\.example\//);
    expect(ld.itemListElement[2].item).toBe('https://verse.example/hire/drummer/mumbai');
    // Static pages carry none: their JSON-LD (Organization, WebSite) is rendered by the page itself.
    expect(readFileSync(join(dist, 'pricing', 'index.html'), 'utf8')).not.toContain('application/ld+json');
    const rates = readFileSync(join(dist, 'rates', 'goa', 'index.html'), 'utf8');
    expect(rates).toContain('"item":"https://verse.example/rates/goa"');
  });

  it('has a breadcrumb for each of the 208 seo pages', () => {
    const lists = readSeoPages(readFileSync(resolve(process.cwd(), 'backend/config/seo_pages.yml'), 'utf8'));
    expect(Object.keys(seoPageBreadcrumbs(lists, 'https://verse.example'))).toHaveLength(12 * 16 + 16);
  });

  it('keeps the hire and rates titles and descriptions unique across all pages', () => {
    const lists = readSeoPages(readFileSync(resolve(process.cwd(), 'backend/config/seo_pages.yml'), 'utf8'));
    const routes = seoPageRoutes(lists);
    const titles = Object.values(routes).map(([title]) => title);
    const descriptions = Object.values(routes).map(([, description]) => description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(routes['/rates/goa'][1]).toContain('reported by verified and unverified musicians');
  });

  it('writes app-shell.html: the neutral shell for dynamic URLs, with no canonical and not the landing head', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' },
    });
    const shell = readFileSync(join(dist, 'app-shell.html'), 'utf8');
    expect(shell).toContain('<title>Verse</title>');
    expect(shell).not.toContain('rel="canonical"');
    expect(shell).not.toContain('Hire verified musicians in Mumbai');
    expect(shell).toContain('<div id="root"></div>');
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toContain(
      '<link rel="canonical" href="https://verse.example/">',
    );
  });

  it('adds a preconnect to a cross-origin API and nothing for a same-origin one', () => {
    expect(apiPreconnect('https://api.verse.example/api')).toBe(
      '<link rel="preconnect" href="https://api.verse.example" crossorigin>',
    );
    expect(apiPreconnect('')).toBe('');
    expect(apiPreconnect('/api')).toBe('');
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], {
      env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example', VITE_API_URL: 'https://api.verse.example/api' },
    });
    for (const file of ['index.html', 'app-shell.html', 'pricing/index.html', '404.html'])
      expect(readFileSync(join(dist, file), 'utf8')).toContain(
        '<link rel="preconnect" href="https://api.verse.example" crossorigin>',
      );
  });
});
