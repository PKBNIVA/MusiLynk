/**
 * What a signed-out page shows while its code chunk downloads: the page background and a
 * screen-reader status, nothing to paint. The branded splash lives in `PageLoading` and is kept for
 * signed-in workspace routes, where it is not the first thing a visitor sees.
 */
export function PublicPageLoading() {
  return (
    <div className="min-h-screen bg-slate-950 text-white" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
    </div>
  );
}
