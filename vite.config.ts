import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The deployed commit, so errors and the live deploy check can name the exact build.
// Vercel exposes VERCEL_GIT_COMMIT_SHA during builds; VITE_RELEASE overrides it.
const release = (process.env.VITE_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]/g, '');
// Exposed to the app as import.meta.env.VITE_RELEASE (Vite reads VITE_* from process.env).
process.env.VITE_RELEASE = release;

// Which site this build is: `public` (default, the marketplace) or `admin` (the separate admin
// site). routes.tsx branches on import.meta.env.VITE_APP_TARGET, which Vite replaces with this
// literal, so the other site's route table and lazy chunks are never emitted.
const appTarget = process.env.VITE_APP_TARGET === 'admin' ? 'admin' : 'public';
process.env.VITE_APP_TARGET = appTarget;

// <meta name="musilynk-release"> lets the live QA run confirm which commit Vercel is serving.
// The admin build also gets its own title and is kept out of search engines.
function releaseMeta(): Plugin {
  const releaseTag = {
    tag: 'meta',
    attrs: { name: 'musilynk-release', content: release || 'unknown' },
    injectTo: 'head' as const,
  };
  // Google Search Console's HTML-tag ownership verification, public build only. Empty/unset
  // (the default until the site is verified) injects nothing.
  const siteVerification = (process.env.VITE_GOOGLE_SITE_VERIFICATION || '').trim();
  const publicTags =
    appTarget === 'admin' || !siteVerification
      ? [releaseTag]
      : [
          releaseTag,
          {
            tag: 'meta',
            attrs: { name: 'google-site-verification', content: siteVerification },
            injectTo: 'head' as const,
          },
        ];
  return {
    name: 'musilynk-release-meta',
    transformIndexHtml: (html) =>
      appTarget === 'admin'
        ? {
            html: html
              .replace(/<title>[^<]*<\/title>/, '<title>MusiLynk Admin</title>')
              .replace(/\s*<meta name="description"[^>]*>/, '')
              .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />'),
            tags: [releaseTag],
          }
        : publicTags,
  };
}

// CHUNK_REPORT=1 writes dist/chunk-report.json (chunk file -> modules and bytes) for `npm run check:perf`
// investigations: which module made a chunk grow, or why a page requests a chunk at all.
function chunkReport(): Plugin {
  return {
    name: 'musilynk-chunk-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!process.env.CHUNK_REPORT) return;
      const report: Record<string, { bytes: number; imports: string[]; modules: string[] }> = {};
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        report[file] = {
          bytes: output.code.length,
          imports: output.imports,
          modules: Object.keys(output.modules).map((id) =>
            id.replace(/^.*[\\/]node_modules[\\/]/, 'node_modules/').replace(process.cwd() + '/', ''),
          ),
        };
      }
      this.emitFile({ type: 'asset', fileName: 'chunk-report.json', source: JSON.stringify(report, null, 1) });
    },
  };
}

// `npm run dev` proxies /api to the Rails API (backend/, `bin/rails server -p 3000`).
// `vite preview` would inherit server.proxy by default, so it is disabled there: Playwright
// runs mock /api in the browser, and integration runs set VITE_API_URL explicitly.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss(), releaseMeta(), chunkReport()],
  // The pre-render bundle (npm run build:ssr) is a Node module; it needs no copy of public/.
  publicDir: isSsrBuild ? false : 'public',
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  preview: { proxy: {} },
  build: {
    rolldownOptions: {
      output: {
        // Chunking is tuned for few requests on a slow phone (`npm run check:perf`, scripts/perf/budget.json)
        // while `npm run check:bundle` keeps the initial JS inside bundle-budget.json. Groups, highest
        // priority first (a module goes to the first group that captures it):
        //   react-vendor  React, React DOM and the router: change rarely, so a long-cached chunk of their own.
        //   app           everything else the first paint needs statically ($initial). Rolldown folds it into
        //                 the entry, so the boot is three files instead of the entry plus seven preloads.
        //   icons         every Lucide icon a lazy page uses, one cached chunk instead of one request per icon.
        //   radix         the Radix primitives and their helpers (floating-ui, remove-scroll) in one chunk.
        //   ui            the src/app/components/ui wrappers, which are tiny and used by nearly every page.
        //   landing       the editorial-photo and talent-card kit shared by the home, hire and directory pages.
        // Groups with includeDependenciesRecursively: false only take the matched files, so a wrapper never
        // drags a library into a chunk that pages would then download for nothing. CHUNK_REPORT=1 on a build
        // writes dist/chunk-report.json to see what landed where.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/,
              priority: 4,
            },
            { name: 'app', tags: ['$initial'], priority: 3 },
            { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 2 },
            { name: 'radix', test: /[\\/]node_modules[\\/]@radix-ui[\\/]/, priority: 2 },
            {
              name: 'ui',
              test: /[\\/]src[\\/]app[\\/]components[\\/]ui[\\/]/,
              includeDependenciesRecursively: false,
              priority: 1,
            },
            {
              name: 'landing',
              test: /[\\/]src[\\/]app[\\/](components[\\/](landing|media)[\\/]|components[\\/]talent[\\/](FirstSample|TalentCard|ActCard)\.tsx|components[\\/]kit[\\/](PlayChip|UserAvatar|FormatGlyph)\.tsx|lib[\\/](photo|landing|seoPages|personLine|avatar|coverArt|useFirstSample)\.ts|pages[\\/]public[\\/]imageCredits)/,
              minShareCount: 2,
              includeDependenciesRecursively: false,
              priority: 1,
            },
          ],
        },
      },
    },
  },
}));
