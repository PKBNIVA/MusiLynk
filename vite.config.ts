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

// <meta name="verse-release"> lets the live QA run confirm which commit Vercel is serving.
// The admin build also gets its own title and is kept out of search engines.
function releaseMeta(): Plugin {
  const releaseTag = {
    tag: 'meta',
    attrs: { name: 'verse-release', content: release || 'unknown' },
    injectTo: 'head' as const,
  };
  return {
    name: 'verse-release-meta',
    transformIndexHtml: (html) =>
      appTarget === 'admin'
        ? {
            html: html
              .replace(/<title>[^<]*<\/title>/, '<title>Verse Admin</title>')
              .replace(/\s*<meta name="description"[^>]*>/, '')
              .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow" />'),
            tags: [releaseTag],
          }
        : [releaseTag],
  };
}

// `npm run dev` proxies /api to the Rails API (backend/, `bin/rails server -p 3000`).
// `vite preview` would inherit server.proxy by default, so it is disabled there: Playwright
// runs mock /api in the browser, and integration runs set VITE_API_URL explicitly.
export default defineConfig({
  plugins: [react(), tailwindcss(), releaseMeta()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  preview: { proxy: {} },
  build: {
    rolldownOptions: {
      output: {
        // React, React DOM and the router change rarely, so they get their own long-cached
        // chunk instead of being folded into the entry (which changes on every deploy).
        // `npm run check:bundle` enforces the size budgets in bundle-budget.json.
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
          ],
        },
      },
    },
  },
});
