import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_WINDOW_MS,
  claimChunkReload,
  clearChunkReloadGuard,
  failedChunkUrl,
  installPreloadErrorGuard,
  isChunkLoadError,
  resetChunkReloadForTests,
} from '../chunkReload';

beforeEach(() => {
  sessionStorage.clear();
  resetChunkReloadForTests();
});

describe('isChunkLoadError', () => {
  it('recognises the browser messages for a missing chunk', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x.test/assets/Pricing-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/a.css',
      'Loading chunk 12 failed.',
    ])
      expect(isChunkLoadError(new Error(message)), message).toBe(true);
    const named = new Error('x');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });
  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error('Network down'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError({ status: 404 })).toBe(false);
  });
});

describe('claimChunkReload', () => {
  it('allows one reload, remembering the time and the failing URL, then refuses inside the window', () => {
    expect(claimChunkReload('https://x.test/assets/a.js', 1_000_000)).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1000000');
    expect(sessionStorage.getItem(`${CHUNK_RELOAD_KEY}:url`)).toBe('https://x.test/assets/a.js');
    // The page reloads: a fresh module state, the same tab storage.
    resetChunkReloadForTests();
    expect(claimChunkReload('https://x.test/assets/a.js', 1_000_000 + 5_000)).toBe(false);
    expect(claimChunkReload('https://x.test/assets/other.js', 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false);
  });
  it('allows another reload once the window has passed or after a manual Reload', () => {
    expect(claimChunkReload('', 1_000_000)).toBe(true);
    resetChunkReloadForTests();
    expect(claimChunkReload('', 1_000_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(true);
    resetChunkReloadForTests();
    expect(claimChunkReload('', 1_000_000 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(false);
    clearChunkReloadGuard();
    expect(claimChunkReload('', 1_000_000 + CHUNK_RELOAD_WINDOW_MS + 2)).toBe(true);
  });
  it('answers true for repeat callers in the same page load (the one scheduled reload)', () => {
    expect(claimChunkReload('a', 1_000_000)).toBe(true);
    expect(claimChunkReload('b', 1_000_006)).toBe(true);
  });
  it('refuses when sessionStorage is unavailable, so a reload can never loop', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(claimChunkReload('x')).toBe(false);
    spy.mockRestore();
  });
});

describe('failedChunkUrl', () => {
  it('extracts the module URL', () => {
    expect(failedChunkUrl(new Error('Failed to fetch dynamically imported module: https://x.test/assets/P-1.js'))).toBe(
      'https://x.test/assets/P-1.js',
    );
    expect(failedChunkUrl(new Error('no url'))).toBe('');
    expect(failedChunkUrl(null)).toBe('');
  });
});

describe('installPreloadErrorGuard', () => {
  const fire = (error: unknown) => {
    const event = new Event('vite:preloadError', { cancelable: true });
    (event as Event & { payload?: unknown }).payload = error;
    window.dispatchEvent(event);
    return event;
  };
  it('reloads once on vite:preloadError and swallows the error, then lets the second one through', () => {
    const reload = vi.fn();
    const off = installPreloadErrorGuard(window, reload);
    const first = fire(new Error('Unable to preload CSS for /assets/a.css'));
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    resetChunkReloadForTests(); // as after the reload
    const second = fire(new Error('Unable to preload CSS for /assets/a.css'));
    expect(second.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    off();
    fire(new Error('x'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
