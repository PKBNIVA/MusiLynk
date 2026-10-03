import { lazy, Suspense, useEffect, useState } from 'react';
import { RouterProvider, type DataRouter } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './lib/authContext';
import { AppErrorBoundary } from './components/ExperienceStates';
import { PlanLimitPrompt } from './components/PlanLimitPrompt';

// Dynamically imported so the analytics module (queueing, flush timers, sendBeacon wiring) stays out
// of the entry chunk, and started a frame after the first paint so it never competes with the route
// chunk and the hero image for it; initRouteTracking records the page the router is already on.
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    setTimeout(() => void import('./lib/analytics').then((m) => m.initRouteTracking(router)), 300);
  });
}

// The toast container is loaded once the browser is idle after the first paint, so its chunk stays out
// of the entry and off the critical path of the route chunk and the hero image. Toasts raised before
// it mounts are kept by sonner and shown as soon as it subscribes.
const Toaster = lazy(() => import('./components/ui/sonner').then((module) => ({ default: module.Toaster })));

/** Runs `callback` when the browser is next idle, at the latest after `timeout` ms (Safari has no requestIdleCallback). */
export function whenIdle(callback: () => void, timeout = 1_500): () => void {
  const idle: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
  if (idle) {
    const id = idle(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 250);
  return () => window.clearTimeout(id);
}

/** True from the first idle moment after mount; what should not compete with the first paint waits on it. */
export function useIdleReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => whenIdle(() => setReady(true)), []);
  return ready;
}

function DeferredToaster() {
  if (!useIdleReady()) return null;
  return (
    <Suspense fallback={null}>
      <Toaster position="top-right" richColors closeButton />
    </Suspense>
  );
}

// Animations are plain CSS; styles/index.css shortens them for prefers-reduced-motion.
// `router` defaults to the browser router; the build-time pre-render passes a memory router for the
// route it is rendering and must produce exactly this tree, or hydration would have to redo it.
export default function App({ router: activeRouter = router }: { router?: DataRouter }) {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={activeRouter} />
        <DeferredToaster />
        <PlanLimitPrompt />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
