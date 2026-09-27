import { lazy, Suspense } from 'react';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './lib/authContext';
import { AppErrorBoundary } from './components/ExperienceStates';
import { PlanLimitPrompt } from './components/PlanLimitPrompt';

// The toast container is loaded after the first render so it stays out of the entry chunk.
// Toasts raised before it mounts are kept by sonner and shown as soon as it subscribes.
const Toaster = lazy(() => import('./components/ui/sonner').then((module) => ({ default: module.Toaster })));

// Animations are plain CSS; styles/index.css shortens them for prefers-reduced-motion.
export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
        <Suspense fallback={null}>
          <Toaster position="top-right" richColors closeButton />
        </Suspense>
        <PlanLimitPrompt />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
