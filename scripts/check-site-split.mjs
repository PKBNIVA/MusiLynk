#!/usr/bin/env node
// Proves the public and admin builds do not contain each other's pages (see VITE_APP_TARGET in
// vite.config.ts and src/app/routes.tsx). Run after `npm run build` and
// `VITE_APP_TARGET=admin vite build --outDir dist-admin`; `npm run check:split` does both builds.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > -1 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
};
const builds = {
  public: option('--public', join(root, 'dist')),
  admin: option('--admin', join(root, 'dist-admin')),
};

// Strings and chunk names that exist only in the other site's pages.
const forbidden = {
  public: {
    chunks: /^(Admin|SignInDoctor|OperationsPanel|DemoDataPanel|ReportReview)/,
    text: [
      'Sign-in doctor',
      'admin-user-filter',
      'Marketplace health',
      'Live Tester',
      '/admin/account',
      'MusiLynk Admin',
    ],
  },
  admin: {
    chunks: /^(LandingPage|AuthPage|JobSearch|PostJob|Pricing|PublicJobs|PublicTalent|SiteMapPage|Messages)/,
    text: ['One login. Your whole', 'Find work and build a career', '/music-professionals', 'Hire music talent'],
  },
};
const robots = {
  public: /<meta name="robots" content="index/,
  admin: /<meta name="robots" content="noindex, nofollow"/,
};

let failed = false;
const fail = (message) => {
  console.error(`  FAIL ${message}`);
  failed = true;
};
for (const [target, dist] of Object.entries(builds)) {
  console.log(`${target} build (${dist})`);
  if (!existsSync(join(dist, 'index.html'))) {
    fail(`${join(dist, 'index.html')} not found: build the ${target} site first.`);
    continue;
  }
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  if (!robots[target].test(html)) fail(`index.html has the wrong robots meta for the ${target} site`);
  if (target === 'admin' && !html.includes('<title>MusiLynk Admin</title>'))
    fail('index.html title is not "MusiLynk Admin"');
  const assets = readdirSync(join(dist, 'assets'));
  const chunks = assets.filter((name) => forbidden[target].chunks.test(name));
  if (chunks.length) fail(`contains the other site's chunks: ${chunks.join(', ')}`);
  for (const name of assets.filter((file) => /\.(js|css|html)$/.test(file))) {
    const text = readFileSync(join(dist, 'assets', name), 'utf8');
    for (const marker of forbidden[target].text) if (text.includes(marker)) fail(`assets/${name} contains "${marker}"`);
  }
  console.log(`  ${assets.length} assets checked`);
}
if (failed) {
  console.error('\nThe public and admin builds must not share pages: declare lazy pages inside their route function.');
  process.exit(1);
}
console.log('Site split OK: neither build contains the other site.');
