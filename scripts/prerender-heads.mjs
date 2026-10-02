#!/usr/bin/env node
// Writes a per-route dist/<path>/index.html for each static public page, with its own <title>,
// meta description and canonical/og/twitter tags baked in (item 5 of the SEO change set). Static
// hosts and crawlers that don't execute usePageMeta's client-side effect (src/app/components/
// PageMeta.tsx) still see the right head for these routes; <div id="root"> is left untouched so
// the SPA still mounts and takes over normally.
//
// It also writes a head for every role x city hire page and every city rates page (the fixed lists in
// backend/config/seo_pages.yml: 12 roles x 16 cities, 16 cities), worded exactly as HirePage.tsx and
// RatesPage.tsx word them, so a crawler that never runs the page's JavaScript still sees the right head.
// Those heads carry no noindex: the page sets noindex itself from its first render and drops it once the API confirms it is indexable.
//
// Runs at the end of `npm run build` (see package.json) for the public build only — skipped when
// VITE_APP_TARGET=admin, which never calls this script (build:admin invokes `vite build` directly).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.VITE_PUBLIC_URL || 'https://musilynk.vercel.app').replace(/\/+$/, '');

// path -> [title, description]. Written to match what each page's usePageMeta call sets.
export const ROUTES = {
  '/': [
    'Hire verified musicians in Mumbai within 24 hours',
    'Hire verified singers, session players, DJs and sound crew in Mumbai for recording sessions, weddings and gigs, within 24 hours. Musicians join free.',
  ],
  '/music-jobs': [
    'Music jobs, gigs, sessions & auditions',
    'Browse open music jobs, gigs, studio sessions, auditions and tours across performance, production and live events.',
  ],
  '/music-professionals': [
    'Find musicians & music professionals',
    'Search singers, instrumentalists, composers, engineers, technical directors, tour crew and managers on MusiLynk.',
  ],
  '/book-music': [
    'Book singers, bands & live acts',
    'Discover bookable singers, duos, bands and ensembles, compare lineups and request a quote for your event on MusiLynk.',
  ],
  '/urgent': [
    'Need someone by tomorrow?',
    'Post an urgent music hiring request and get matched with available, verified musicians and crew near you within hours.',
  ],
  '/join/hiring': [
    'Join to hire musicians and crew',
    'Studios, event and wedding companies, bands, labels and venues: create a free account in two minutes and find a verified musician in Mumbai within 24 hours.',
  ],
  '/join/musician': [
    'Join as a musician or crew',
    'Create a verified music portfolio in two minutes: pick your role, paste links to your YouTube, Instagram, SoundCloud or Spotify work, and get booked in Mumbai.',
  ],
  '/pricing': [
    'Pricing',
    'MusiLynk plans for music hiring and booking teams. Professionals build profiles and apply free; paid plans add capacity, seats and trials.',
  ],
  '/guide': [
    'How to use MusiLynk',
    'Step-by-step guides for music professionals, hiring teams, bands and event bookers on MusiLynk.',
  ],
  '/about': [
    'About MusiLynk',
    'MusiLynk connects musicians, bands and hiring teams for gigs, sessions and live bookings across India.',
  ],
  '/safety': [
    'Trust & Safety',
    'How MusiLynk verifies professionals, protects payments and keeps the marketplace safe.',
  ],
  '/credits': [
    'Photo credits',
    'The photographers and licences behind the pictures on MusiLynk, from Wikimedia Commons under Creative Commons and public-domain terms.',
  ],
  '/contact': ['Contact MusiLynk', 'Get in touch with the MusiLynk team.'],
  '/community-guidelines': [
    'Community guidelines',
    'The standards MusiLynk expects from every musician, band and hiring team on the platform.',
  ],
  '/terms': ['Terms of service', "MusiLynk's terms of service."],
  '/privacy': ['Privacy policy', "MusiLynk's privacy policy."],
};

/** The `roles:` and `cities:` maps of backend/config/seo_pages.yml (flat `slug: Label` lines). */
export function readSeoPages(yaml) {
  const lists = { roles: [], cities: [] };
  let current = null;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const section = line.match(/^(roles|cities):\s*$/);
    if (section) {
      current = section[1];
      continue;
    }
    const entry = line.match(/^\s+([a-z0-9-]+):\s*(.+?)\s*$/);
    if (entry && current) lists[current].push([entry[1], entry[2]]);
    else if (/^\S/.test(line)) current = null;
  }
  return lists;
}

const lowerRole = (label) => (label === 'DJ' ? label : label.toLowerCase());

/** path -> [title, description] for the hire and rates pages, as the pages set them client-side. */
export function seoPageRoutes({ roles, cities }) {
  const routes = {};
  for (const [roleSlug, role] of roles) {
    for (const [citySlug, city] of cities) {
      routes[`/hire/${roleSlug}/${citySlug}`] = [
        `Hire a verified ${lowerRole(role)} in ${city} | MusiLynk`,
        `Browse verified ${lowerRole(role)}s in ${city} with real work you can review. Post an urgent request and hear back within hours, or browse the directory.`,
      ];
    }
  }
  for (const [citySlug, city] of cities) {
    routes[`/rates/${citySlug}`] = [
      `What musicians charge in ${city} | MusiLynk`,
      `Median session, show and day rates reported by verified and unverified musicians on MusiLynk in ${city}. A guide, not a quote.`,
    ];
  }
  return routes;
}

/** Opens the connection to a cross-origin API (VITE_API_URL) while the entry script downloads, instead of
 *  after it runs and makes its first request. Returns '' for a same-origin or unset API. */
export function apiPreconnect(apiUrl) {
  try {
    const origin = new URL(apiUrl).origin;
    return origin === 'null' ? '' : `<link rel="preconnect" href="${origin}" crossorigin>`;
  } catch {
    return '';
  }
}

/** PageMeta.tsx cuts a description at 160 characters; do the same so the head matches the page. */
const clip = (text) => (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text);

/** The ld+json script carries PageMeta.tsx's data-page-meta marker, so the page's own JSON-LD replaces it
 *  on hydration instead of sitting next to it as a second, possibly different, copy. */
function jsonLdTag(jsonLd) {
  if (!jsonLd) return '';
  const json = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  return `\n    <script type="application/ld+json" data-page-meta>${json}</script>`;
}

/** BreadcrumbList for a hire or rates page, with the absolute item URLs Google requires. */
export function breadcrumbs(baseUrl, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: `${baseUrl}${path}`,
    })),
  };
}

/** path -> BreadcrumbList for the hire and rates pages (the home > hub > page trail HirePage.tsx builds). */
export function seoPageBreadcrumbs({ roles, cities }, baseUrl = BASE_URL) {
  const out = {};
  for (const [roleSlug, role] of roles)
    for (const [citySlug, city] of cities) {
      const path = `/hire/${roleSlug}/${citySlug}`;
      out[path] = breadcrumbs(baseUrl, [
        ['MusiLynk', '/'],
        ['Musicians', '/music-professionals'],
        [`${role} in ${city}`, path],
      ]);
    }
  for (const [citySlug, city] of cities) {
    const path = `/rates/${citySlug}`;
    out[path] = breadcrumbs(baseUrl, [
      ['MusiLynk', '/'],
      ['Musicians', '/music-professionals'],
      [`Rates in ${city}`, path],
    ]);
  }
  return out;
}

function pageHead({ title, description, canonical, image, jsonLd }) {
  return `    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="MusiLynk">
    <meta property="og:locale" content="en_IN">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">${jsonLdTag(jsonLd)}
  </head>`;
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function render(indexHtml, path, [title, description], jsonLd) {
  const canonical = `${BASE_URL}${path}`;
  const image = `${BASE_URL}/og-default.png`;
  const head = pageHead({
    title: escapeHtml(title),
    description: escapeHtml(description),
    canonical,
    image,
    jsonLd,
  });
  // index.html carries document-level defaults (title, description, og:*, twitter:*); a page's own
  // head replaces them rather than repeating them.
  let html = indexHtml
    .replace(/<title>[^<]*<\/title>\s*/, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/, '')
    .replace(/<meta\s+(?:property="og:|name="twitter:)[^>]*>\s*/g, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/, '');
  html = html.replace('</head>', `${head}`);
  return html;
}

/**
 * dist/404.html. Vercel serves it, with a real 404 status, for every URL no rewrite in vercel.json
 * claims, so an unknown path is a hard 404 to crawlers while the SPA still mounts for people and shows
 * its own not-found page. noindex stays in the markup in case a proxy ever serves it with a 200.
 */
export function renderNotFound(indexHtml) {
  const title = 'Page not found | MusiLynk';
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta\s+name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow">')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/, '');
}

export function rewriteRobots(robotsTxt, baseUrl) {
  return robotsTxt.replace(/^Sitemap:.*$/m, `Sitemap: ${baseUrl}/sitemap.xml`);
}

/**
 * The paths of the admin site's route table (adminRoutes() in src/app/routes.tsx), without the root and the
 * catch-all. Read from the source so a new admin route cannot be forgotten.
 */
export function adminRoutePaths(routesSource) {
  const start = routesSource.indexOf('// The separate admin site');
  if (start < 0) return [];
  const paths = new Set();
  for (const match of routesSource.slice(start).matchAll(/path:\s*'(\/[^'*]*)'/g))
    if (match[1] !== '/') paths.add(match[1]);
  const dynamic = [...paths].filter((path) => path.includes(':'));
  if (dynamic.length)
    throw new Error(
      `Admin routes with parameters (${dynamic.join(', ')}) cannot be served as files; add a rewrite for them to vercel.json.`,
    );
  return [...paths];
}

/**
 * The admin build (VITE_APP_TARGET=admin) shares vercel.json with the public site, whose rewrites only know the
 * public routes. Files are served before rewrites, so the admin build writes its own shell to every admin
 * route and to 404.html: a reload of /admin or /account, or any unknown path, still boots the SPA (which shows
 * its own sign-in or not-found page). The admin site is noindex, so none of this is crawlable.
 */
export function writeAdminShells(distDir, routesSource) {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(`${indexPath} not found: run \`vite build\` first.`);
    process.exitCode = 2;
    return [];
  }
  const html = readFileSync(indexPath, 'utf8');
  const paths = adminRoutePaths(routesSource);
  for (const path of paths) {
    mkdirSync(join(distDir, path), { recursive: true });
    writeFileSync(join(distDir, path, 'index.html'), html);
  }
  writeFileSync(join(distDir, '404.html'), html);
  return paths;
}

function main(distDir = join(root, 'dist')) {
  if (process.env.VITE_APP_TARGET === 'admin') {
    const paths = writeAdminShells(distDir, readFileSync(join(root, 'src', 'app', 'routes.tsx'), 'utf8'));
    console.log(`prerender-heads: admin build, wrote the app shell to ${paths.join(', ')} and 404.html`);
    return;
  }
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    console.error(`${indexPath} not found: run \`vite build\` first.`);
    process.exitCode = 2;
    return;
  }
  const hint = apiPreconnect(process.env.VITE_API_URL || '');
  const builtHtml = readFileSync(indexPath, 'utf8');
  const indexHtml = hint ? builtHtml.replace('</head>', `    ${hint}\n  </head>`) : builtHtml;

  const seoYaml = join(root, 'backend', 'config', 'seo_pages.yml');
  const seoLists = existsSync(seoYaml) ? readSeoPages(readFileSync(seoYaml, 'utf8')) : { roles: [], cities: [] };
  const seoRoutes = seoPageRoutes(seoLists);
  const routes = { ...ROUTES, ...seoRoutes };
  const jsonLd = seoPageBreadcrumbs(seoLists);
  // dist/index.html is about to become the landing page's own head, but Vercel also falls back to it for
  // every dynamic URL (/professionals/:id, /opportunities/:id, /acts/:id, ...), which would then all say
  // "canonical: /" and carry the landing title. app-shell.html is the neutral shell (no canonical, default
  // title and description) that vercel.json serves for those instead; 404.html is built from it too.
  writeFileSync(join(distDir, 'app-shell.html'), indexHtml.replace(/<link\s+rel="canonical"[^>]*>\s*/, ''));

  for (const [path, meta] of Object.entries(routes)) {
    const outDir = path === '/' ? distDir : join(distDir, path);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), render(indexHtml, path, [meta[0], clip(meta[1])], jsonLd[path]));
  }
  writeFileSync(join(distDir, '404.html'), renderNotFound(indexHtml));

  const robotsPath = join(distDir, 'robots.txt');
  if (existsSync(robotsPath)) {
    writeFileSync(robotsPath, rewriteRobots(readFileSync(robotsPath, 'utf8'), BASE_URL));
  }

  console.log(
    `prerender-heads: wrote ${Object.keys(routes).length} route heads (${Object.keys(seoRoutes).length} hire and rates pages) to ${distDir}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? resolve(process.argv[2]) : undefined);
}
