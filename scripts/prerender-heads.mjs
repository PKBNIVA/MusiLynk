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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HERO_PHOTO, HERO_PHOTO_SIZES, HERO_PHOTO_WIDTHS, photoSrcSet } from '../src/app/lib/photo.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { BRAND_NAME } from '../src/app/lib/brand.ts';
import { PUBLIC_PAGE_META, clipDescription, documentTitle, publicOrigin } from '../src/app/lib/siteMeta.ts';
import { hirePageDescription, hirePageTitle, ratesPageDescription, ratesPageTitle } from '../src/app/lib/seoPages.ts';

const BASE_URL = publicOrigin();

// path -> [title, description], from the same table the pages read (src/app/lib/siteMeta.ts), so the baked
// head and the one usePageMeta sets after hydration are identical.
export const ROUTES = Object.fromEntries(
  Object.entries(PUBLIC_PAGE_META).map(([path, meta]) => [path, [meta.title, meta.description]]),
);

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

/** path -> [title, description] for the hire and rates pages, from the same builders the pages use (seoPages.ts). */
export function seoPageRoutes({ roles, cities }) {
  const routes = {};
  for (const [roleSlug, role] of roles) {
    for (const [citySlug, city] of cities) {
      routes[`/hire/${roleSlug}/${citySlug}`] = [hirePageTitle(role, city), hirePageDescription(role, city)];
    }
  }
  for (const [citySlug, city] of cities) {
    routes[`/rates/${citySlug}`] = [ratesPageTitle(city), ratesPageDescription(city)];
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

/** Lets the browser resolve the uploads host (profile and act photos on R2, VITE_UPLOADS_ORIGIN) before the
 *  first card renders. Returns '' when unset or not an absolute URL. */
export function uploadsDnsPrefetch(uploadsOrigin) {
  try {
    const origin = new URL(uploadsOrigin).origin;
    return origin === 'null' ? '' : `<link rel="dns-prefetch" href="${origin}">`;
  } catch {
    return '';
  }
}

/** The home page's LCP element is the hero photo, rendered by a lazy route chunk. Preloading it from the
 *  HTML (AVIF, the same srcset and sizes as <LandingHero>) starts the download with the entry script
 *  instead of two round trips later. Only dist/index.html (path "/") carries it. */
export function heroPreload() {
  const srcset = photoSrcSet(`/img/${HERO_PHOTO}`, HERO_PHOTO_WIDTHS, 'avif');
  return `<link rel="preload" as="image" type="image/avif" imagesrcset="${srcset}" imagesizes="${HERO_PHOTO_SIZES}" fetchpriority="high">`;
}

// ---- Body pre-rendering ----------------------------------------------------------------------------
// Beyond the <head>, these routes also get their first screen as HTML (src/entry-server.tsx, built by
// `npm run build:ssr` into dist-ssr/), so text paints before any JavaScript runs; main.tsx hydrates it in
// place. Pages whose first screen depends on who is looking (search, sign-in, the workspace) stay
// client-rendered. The hire and rates pages are added from backend/config/seo_pages.yml at run time.
export const PRERENDERED_PATHS = [
  '/',
  '/music-jobs',
  '/music-professionals',
  '/book-music',
  '/urgent',
  '/pricing',
  '/guide',
  '/join/hiring',
  '/join/musician',
];
// Record pages: one HTML shell per route family (static frame plus the loading state), served by the
// vercel.json rewrite for every id. `data-prerendered` carries the pattern so main.tsx can check the URL.
export const PRERENDERED_SHELLS = {
  '/professionals/:id': 'professionals',
  '/acts/:id': 'acts',
  '/opportunities/:id': 'opportunities',
};

/** `<div id="root"></div>` -> the same div holding the pre-rendered markup and the route it is for. */
export function withBody(html, route, body) {
  return html.replace('<div id="root"></div>', `<div id="root" data-prerendered="${route}">${body}</div>`);
}

/** The render(url) function of the pre-render bundle, or null when `npm run build:ssr` has not run. */
export async function loadRenderer(ssrDir) {
  const entry = join(ssrDir, 'entry-server.js');
  if (!existsSync(entry)) return null;
  // The bundle leaves React external, so React picks its build from NODE_ENV here: production, the same
  // code the browser bundle ships (the development build also prints a warning per page).
  process.env.NODE_ENV = 'production';
  return (await import(pathToFileURL(entry).href)).render;
}

/** PageMeta.tsx cuts a description at 160 characters; do the same so the head matches the page. */
const clip = clipDescription;

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
  return `    <title>${documentTitle(title, BRAND_NAME)}</title>
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
  if (path === '/') html = html.replace('</head>', `    ${heroPreload()}\n  </head>`);
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

async function main(distDir = join(root, 'dist'), ssrDir = join(root, 'dist-ssr')) {
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
  const hints = [
    apiPreconnect(process.env.VITE_API_URL || ''),
    uploadsDnsPrefetch(process.env.VITE_UPLOADS_ORIGIN || ''),
  ]
    .filter(Boolean)
    .map((hint) => `    ${hint}\n`)
    .join('');
  const builtHtml = readFileSync(indexPath, 'utf8');
  const indexHtml = hints ? builtHtml.replace('</head>', `${hints}  </head>`) : builtHtml;

  const seoYaml = join(root, 'backend', 'config', 'seo_pages.yml');
  const seoLists = existsSync(seoYaml) ? readSeoPages(readFileSync(seoYaml, 'utf8')) : { roles: [], cities: [] };
  const seoRoutes = seoPageRoutes(seoLists);
  const routes = { ...ROUTES, ...seoRoutes };
  const jsonLd = seoPageBreadcrumbs(seoLists);
  // dist/index.html is about to become the landing page's own head, but Vercel also falls back to it for
  // every dynamic URL (/professionals/:id, /opportunities/:id, /acts/:id, ...), which would then all say
  // "canonical: /" and carry the landing title. app-shell.html is the neutral shell (no canonical, default
  // title and description) that vercel.json serves for those instead; 404.html is built from it too.
  const appShellHtml = indexHtml.replace(/<link\s+rel="canonical"[^>]*>\s*/, '');
  writeFileSync(join(distDir, 'app-shell.html'), appShellHtml);

  const renderBody = await loadRenderer(ssrDir);
  if (!renderBody)
    console.warn(`prerender-heads: ${ssrDir}/entry-server.js not found (npm run build:ssr); writing heads only.`);
  const withBodies = new Set([...PRERENDERED_PATHS, ...Object.keys(seoRoutes)]);
  let bodies = 0;
  for (const [path, meta] of Object.entries(routes)) {
    const outDir = path === '/' ? distDir : join(distDir, path);
    mkdirSync(outDir, { recursive: true });
    let html = render(indexHtml, path, [meta[0], clip(meta[1])], jsonLd[path]);
    if (renderBody && withBodies.has(path)) {
      html = withBody(html, path, await renderBody(path));
      bodies += 1;
    }
    writeFileSync(join(outDir, 'index.html'), html);
  }
  if (renderBody) {
    for (const [pattern, dir] of Object.entries(PRERENDERED_SHELLS)) {
      mkdirSync(join(distDir, dir), { recursive: true });
      writeFileSync(
        join(distDir, dir, 'shell.html'),
        withBody(appShellHtml, pattern, await renderBody(`/${dir}/shell`)),
      );
      bodies += 1;
    }
  }
  writeFileSync(join(distDir, '404.html'), renderNotFound(indexHtml));

  const robotsPath = join(distDir, 'robots.txt');
  if (existsSync(robotsPath)) {
    writeFileSync(robotsPath, rewriteRobots(readFileSync(robotsPath, 'utf8'), BASE_URL));
  }

  console.log(
    `prerender-heads: wrote ${Object.keys(routes).length} route heads (${Object.keys(seoRoutes).length} hire and rates pages) and ${bodies} pre-rendered bodies to ${distDir}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(
    process.argv[2] ? resolve(process.argv[2]) : undefined,
    process.argv[3] ? resolve(process.argv[3]) : undefined,
  );
}
