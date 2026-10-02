/**
 * Stale-deploy recovery. After a redeploy the old hashed JS/CSS chunks are gone, so a tab that is
 * still holding the old HTML fails to load a lazy page ("Failed to fetch dynamically imported
 * module"). We reload once to pick up the new HTML; if that fails again inside the window we stop
 * and let the route error page offer a manual Reload, so this can never loop.
 */

export const CHUNK_RELOAD_KEY = 'verse_chunk_reload_at';
/** A reload that fails again inside this window shows the error page instead of reloading forever. */
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

/** True when a lazily loaded page's JS/CSS could not be fetched, typically after a redeploy removed old chunks. */
export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : '';
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (CSS )?chunk \S+ failed/i.test(
    message,
  );
}

let reloadScheduled = false;

/** Test hook: forget that a reload was claimed in this page load. */
export function resetChunkReloadForTests() {
  reloadScheduled = false;
}

/**
 * Claims the single automatic reload for this tab, recording when and for which module. Returns
 * false when a reload was already attempted recently or the guard cannot be stored (a reload
 * could then loop).
 */
export function claimChunkReload(failedUrl = '', now = Date.now()) {
  if (reloadScheduled) return true;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    if (now - last < CHUNK_RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    sessionStorage.setItem(`${CHUNK_RELOAD_KEY}:url`, failedUrl.slice(0, 300));
  } catch {
    return false;
  }
  reloadScheduled = true;
  return true;
}

/** Lets a deliberate "Reload" click retry the automatic recovery once more. */
export function clearChunkReloadGuard() {
  reloadScheduled = false;
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    sessionStorage.removeItem(`${CHUNK_RELOAD_KEY}:url`);
  } catch {
    /* storage blocked */
  }
}

/** The module URL in a "Failed to fetch dynamically imported module: <url>" message, if any. */
export function failedChunkUrl(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /https?:\/\/\S+/.exec(message)?.[0] ?? '';
}

/**
 * Vite emits `vite:preloadError` when a lazy chunk or its CSS fails to load, including for lazy
 * components outside the router. Reload once; otherwise leave the error to the route error page.
 */
export function installPreloadErrorGuard(target: Window = window, reload: () => void = () => location.reload()) {
  const onError = (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (!claimChunkReload(failedChunkUrl(payload))) return;
    event.preventDefault();
    reload();
  };
  target.addEventListener('vite:preloadError', onError);
  return () => target.removeEventListener('vite:preloadError', onError);
}
