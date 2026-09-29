import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const scriptPath = resolve(process.cwd(), 'scripts/prerender-heads.mjs');

const FAKE_INDEX = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verse</title>
  <meta name="description" content="default description">
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
    execFileSync(process.execPath, [scriptPath, dist], { env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' } });

    const html = readFileSync(join(dist, 'pricing', 'index.html'), 'utf8');
    expect(html).toContain('<title>Pricing</title>');
    expect(html).toContain('<link rel="canonical" href="https://verse.example/pricing">');
    expect(html).toContain('<meta property="og:url" content="https://verse.example/pricing">');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
  });

  it('writes the root route to dist/index.html itself', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], { env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' } });
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html).toContain('Hire verified musicians in Mumbai within 24 hours');
    expect(html).toContain('<link rel="canonical" href="https://verse.example/">');
  });

  it('rewrites the robots.txt Sitemap line to the configured base URL', () => {
    const dist = makeDist();
    execFileSync(process.execPath, [scriptPath, dist], { env: { ...process.env, VITE_PUBLIC_URL: 'https://verse.example' } });
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
});
