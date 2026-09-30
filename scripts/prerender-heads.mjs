#!/usr/bin/env node
// Writes a per-route dist/<path>/index.html for each static public page, with its own <title>,
// meta description and canonical/og/twitter tags baked in (item 5 of the SEO change set). Static
// hosts and crawlers that don't execute usePageMeta's client-side effect (src/app/components/
// PageMeta.tsx) still see the right head for these routes; <div id="root"> is left untouched so
// the SPA still mounts and takes over normally.
//
// Runs at the end of `npm run build` (see package.json) for the public build only — skipped when
// VITE_APP_TARGET=admin, which never calls this script (build:admin invokes `vite build` directly).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.VITE_PUBLIC_URL || 'https://verse-music-platform.vercel.app').replace(/\/+$/, '');

// path -> [title, description]. Written to match what each page's usePageMeta call sets.
export const ROUTES = {
  '/': ['Hire verified musicians in Mumbai within 24 hours', 'Hire verified singers, session players, DJs and sound crew in Mumbai for recording sessions, weddings and gigs, within 24 hours. Musicians join free.'],
  '/music-jobs': ['Music jobs, gigs, sessions & auditions', 'Browse open music jobs, gigs, studio sessions, auditions and tours across performance, production and live events.'],
  '/music-professionals': ['Find musicians & music professionals', 'Search singers, instrumentalists, composers, engineers, technical directors, tour crew and managers on Verse.'],
  '/book-music': ['Book singers, bands & live acts', 'Discover bookable singers, duos, bands and ensembles, compare lineups and request a quote for your event on Verse.'],
  '/urgent': ['Need someone by tomorrow?', 'Post an urgent music hiring request and get matched with available, verified musicians and crew near you within hours.'],
  '/join/hiring': ['Join to hire musicians and crew', 'Studios, event and wedding companies, bands, labels and venues: create a free account in two minutes and find a verified musician in Mumbai within 24 hours.'],
  '/join/musician': ['Join as a musician or crew', 'Create a verified music portfolio in two minutes: pick your role, paste links to your YouTube, Instagram, SoundCloud or Spotify work, and get booked in Mumbai.'],
  '/pricing': ['Pricing', 'Verse plans for music hiring and booking teams. Professionals build profiles and apply free; paid plans add capacity, seats and trials.'],
  '/guide': ['How to use Verse', 'Step-by-step guides for music professionals, hiring teams, bands and event bookers on Verse.'],
  '/about': ['About Verse', 'Verse connects musicians, bands and hiring teams for gigs, sessions and live bookings across India.'],
  '/safety': ['Trust & Safety', 'How Verse verifies professionals, protects payments and keeps the marketplace safe.'],
  '/credits': ['Photo credits', 'The photographers and licences behind the pictures on Verse, from Wikimedia Commons under Creative Commons and public-domain terms.'],
  '/contact': ['Contact Verse', 'Get in touch with the Verse team.'],
  '/community-guidelines': ['Community guidelines', 'The standards Verse expects from every musician, band and hiring team on the platform.'],
  '/terms': ['Terms of service', "Verse's terms of service."],
  '/privacy': ['Privacy policy', "Verse's privacy policy."],
};

function pageHead({ title, description, canonical, image }) {
  return `    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Verse">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">
  </head>`;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function render(indexHtml, path, [title, description]) {
  const canonical = `${BASE_URL}${path}`;
  const image = `${BASE_URL}/og-default.png`;
  const head = pageHead({ title: escapeHtml(title), description: escapeHtml(description), canonical, image });
  let html = indexHtml.replace(/<title>[^<]*<\/title>\s*/, '').replace(/<meta\s+name="description"[^>]*>\s*/, '');
  html = html.replace('</head>', `${head}`);
  return html;
}

export function rewriteRobots(robotsTxt, baseUrl) {
  return robotsTxt.replace(/^Sitemap:.*$/m, `Sitemap: ${baseUrl}/sitemap.xml`);
}

function main(distDir = join(root, 'dist')) {
  if (process.env.VITE_APP_TARGET === 'admin') return; // never called for the admin build, kept as a safety net.
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(`${indexPath} not found: run \`vite build\` first.`);
    process.exitCode = 2;
    return;
  }
  const indexHtml = readFileSync(indexPath, 'utf8');

  for (const [path, meta] of Object.entries(ROUTES)) {
    const outDir = path === '/' ? distDir : join(distDir, path);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), render(indexHtml, path, meta));
  }

  const robotsPath = join(distDir, 'robots.txt');
  if (existsSync(robotsPath)) {
    writeFileSync(robotsPath, rewriteRobots(readFileSync(robotsPath, 'utf8'), BASE_URL));
  }

  console.log(`prerender-heads: wrote ${Object.keys(ROUTES).length} static route heads to ${distDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? resolve(process.argv[2]) : undefined);
}
