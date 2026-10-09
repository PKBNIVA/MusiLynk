import './app/lib/legacyStorageBoot';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { initMonitoring, RELEASE, reportError } from './app/lib/monitoring';
import { prerenderedRouteMatches } from './app/lib/prerender';
import { installPreloadErrorGuard } from './app/lib/chunkReload';
import './styles/index.css';

// The deployed commit, for support and the live deploy check (also in <meta name="musilynk-release">).
(window as Window & { __MUSILYNK_RELEASE__?: string }).__MUSILYNK_RELEASE__ = RELEASE || 'unknown';
// No-op unless VITE_SENTRY_DSN was set at build time; Sentry itself loads after first render.
initMonitoring();
// A lazy chunk that 404s after a redeploy: reload once for the new build (see chunkReload.ts).
installPreloadErrorGuard();

const root = document.getElementById('root')!;
// A pre-rendered page (scripts/prerender-heads.mjs) ships its first screen as HTML; the app hydrates it in
// place instead of rendering from scratch, so nothing flickers. Only when the HTML is for this route:
// a static host may serve the home page's HTML for a URL it has no file for (see prerenderedRouteMatches).
if (prerenderedRouteMatches(root.dataset.prerendered, location.pathname) && root.firstElementChild) {
  hydrateRoot(root, <App />, {
    onRecoverableError(error, info) {
      // A hydration mismatch is a bug in the pre-render (tests/e2e/prerender.spec.ts asserts there are none).
      console.error(error, info.componentStack);
      reportError(error, { tags: { source: 'hydration' }, extra: { componentStack: info.componentStack } });
    },
  });
  root.dataset.hydrated = 'true';
} else {
  if (root.dataset.prerendered) root.replaceChildren();
  createRoot(root).render(<App />);
}

// Business settings and anonymous feature flags (GET /api/public/config): one lazy fetch after first render,
// out of the entry chunk. Components that read them (usePublicConfig, useFeature) re-render when it lands.
void import('./app/lib/publicConfig').then((m) => m.loadPublicConfig());
