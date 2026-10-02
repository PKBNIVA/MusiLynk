import { createRoot } from 'react-dom/client';
import App from './app/App.tsx';
import { initMonitoring, RELEASE } from './app/lib/monitoring';
import { installPreloadErrorGuard } from './app/lib/chunkReload';
import './styles/index.css';

// The deployed commit, for support and the live deploy check (also in <meta name="verse-release">).
(window as Window & { __VERSE_RELEASE__?: string }).__VERSE_RELEASE__ = RELEASE || 'unknown';
// No-op unless VITE_SENTRY_DSN was set at build time; Sentry itself loads after first render.
initMonitoring();
// A lazy chunk that 404s after a redeploy: reload once for the new build (see chunkReload.ts).
installPreloadErrorGuard();

createRoot(document.getElementById('root')!).render(<App />);
