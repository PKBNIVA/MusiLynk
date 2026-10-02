import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { Button } from './ui/button';
import { reportError } from '../lib/monitoring';
import { openProblemReport } from '../lib/problemReportEvent';
import { claimChunkReload, clearChunkReloadGuard, failedChunkUrl, isChunkLoadError } from '../lib/chunkReload';

export { isChunkLoadError };

export function RouteErrorPage() {
  const error = useRouteError();
  const chunkError = isChunkLoadError(error);
  const reloading = chunkError && claimChunkReload(failedChunkUrl(error));

  useEffect(() => {
    if (reloading) {
      window.location.reload();
      return;
    }
    console.error('Verse route error', error);
    // A stale chunk reaches here only once the one automatic reload has already failed.
    // Route responses such as 404 are expected and not reported.
    if (!isRouteErrorResponse(error) || error.status >= 500) {
      reportError(error, { tags: { source: chunkError ? 'route_chunk_load' : 'route_error' } });
    }
  }, [error, reloading, chunkError]);

  if (reloading) {
    return (
      <div
        className="min-h-screen bg-slate-950 text-white grid place-items-center px-5"
        role="status"
        aria-live="polite"
      >
        <div className="text-center">
          <div className="mx-auto w-fit animate-pulse">
            <BrandMark />
          </div>
          <p className="mt-4 text-sm text-slate-400">Loading the latest version of Verse…</p>
        </div>
      </div>
    );
  }

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = chunkError
    ? 'Verse has been updated.'
    : notFound
      ? 'This page could not be found.'
      : 'This screen missed a beat.';
  const body = chunkError
    ? 'A new version of Verse was released while this page was open. Reload to continue with the latest version.'
    : notFound
      ? 'Check the address, or head back home.'
      : 'Your data is safe. Reload the page to try again, or head back home.';

  const reload = () => {
    // A deliberate reload may retry the automatic chunk recovery once more.
    clearChunkReloadGuard();
    window.location.reload();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white grid place-items-center px-5">
      <div role="alert" className="verse-surface max-w-lg rounded-3xl p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/15 text-rose-300">
          <AlertTriangle aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-black">{title}</h1>
        <p className="mt-3 text-slate-300">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={reload}>
            <RefreshCw size={16} className="mr-2" aria-hidden="true" />
            Reload
          </Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            <Home size={16} className="mr-2" aria-hidden="true" />
            Go home
          </Button>
          {!notFound && !chunkError && (
            <Button variant="outline" onClick={() => openProblemReport({ error })}>
              Tell us what happened
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
