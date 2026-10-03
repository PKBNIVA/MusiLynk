/**
 * The client data layer: a small stale-while-revalidate cache in front of `apiGet`.
 *
 * - One entry per GET path (query string included). Entries belong to the signed-in identity: a sign-in,
 *   sign-out or "act as" change clears everything, so nobody sees another identity's data.
 * - `cachedGet(path, family)` returns fresh data from memory, or stale data at once while refreshing it in
 *   the background, or waits for the network. Concurrent GETs of one path share one request.
 * - TTLs per resource family live in dataCache.config.ts, nowhere else.
 * - A successful write through `api()` (POST/PUT/PATCH/DELETE) marks the paths INVALIDATE_ON_WRITE names
 *   stale and tells subscribers; `invalidate` and `update` do the same by hand.
 * - `subscribe(path, listener)` is how `useCachedGet` re-renders; listeners fire only when the data changed
 *   (deep equality), so polling that returns the same page re-renders nothing.
 *
 * Realtime (R2, Action Cable, owned by the `claude/r2-cable` branch): on a socket event call
 *   `realtime.invalidate(path)`            — mark a cached GET stale and refetch it if a screen shows it;
 *   `realtime.update(path, (data) => next)` — patch the cached data in place (e.g. append a message) and
 *                                             re-render subscribers at once, no request.
 * `path` is the API path as a page requests it, e.g. '/conversations', '/conversations/<id>/messages',
 * '/notifications/unread'. A prefix works for `invalidate` ('/conversations' covers every thread).
 * Sockets themselves are not implemented here.
 */
import * as apiModule from './api';
import { apiGet, type ApiOptions } from './api';
import {
  CACHE_MAX_AGE_MS,
  CACHE_TTL_MS,
  INVALIDATE_ON_WRITE,
  PREFETCH_MAX_IN_FLIGHT,
  PREFETCH_MIN_INTERVAL_MS,
  type CacheFamily,
} from './dataCache.config';

type Entry<T = unknown> = {
  data: T | undefined;
  /** When `data` arrived (ms); 0 when nothing arrived yet. */
  updatedAt: number;
  family: CacheFamily;
  /** Marked by `invalidate` or a write: the next read refreshes even inside the TTL. */
  stale: boolean;
  /** The request in flight for this path, shared by every caller (de-duplication). */
  inFlight: Promise<T> | null;
  error: unknown;
};

type Listener = () => void;

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<Listener>>();

/** Structural equality for API payloads (JSON data: objects, arrays, primitives). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameData(item, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function entryFor<T>(path: string, family: CacheFamily): Entry<T> {
  let entry = entries.get(path) as Entry<T> | undefined;
  if (!entry) {
    entry = { data: undefined, updatedAt: 0, family, stale: false, inFlight: null, error: undefined };
    entries.set(path, entry as Entry);
  }
  return entry;
}

function notify(path: string) {
  listeners.get(path)?.forEach((listener) => {
    try {
      listener();
    } catch {
      /* one listener must not stop the others */
    }
  });
}

/** True when the entry can be shown; `fresh` when it needs no request at all. */
function status(entry: Entry, now = Date.now()) {
  const age = now - entry.updatedAt;
  const has = entry.updatedAt > 0 && age < CACHE_MAX_AGE_MS;
  const fresh = has && !entry.stale && age < CACHE_TTL_MS[entry.family];
  return { has, fresh };
}

/** The cached data for a path, if any and not expired; never triggers a request. */
export function peek<T>(path: string): T | undefined {
  const entry = entries.get(path);
  if (!entry) return undefined;
  return status(entry).has ? (entry.data as T) : undefined;
}

/** True when `path` is cached and still inside its TTL (a read would make no request). */
export function isFresh(path: string): boolean {
  const entry = entries.get(path);
  return Boolean(entry && status(entry).fresh);
}

function request<T>(path: string, entry: Entry<T>, options?: ApiOptions): Promise<T> {
  if (entry.inFlight) return entry.inFlight;
  // Options are passed only when given, so callers and tests see `apiGet(path)` for a plain read.
  const promise = (options && Object.keys(options).length ? apiGet<T>(path, options) : apiGet<T>(path))
    .then((data) => {
      const changed = !sameData(entry.data, data);
      entry.data = data;
      entry.updatedAt = Date.now();
      entry.stale = false;
      entry.error = undefined;
      if (changed) notify(path);
      return data;
    })
    .catch((error: unknown) => {
      entry.error = error;
      throw error;
    })
    .finally(() => {
      if (entry.inFlight === promise) entry.inFlight = null;
    });
  entry.inFlight = promise;
  return promise;
}

export type CachedGetOptions = ApiOptions & {
  /** Resource family for the TTL (dataCache.config.ts). Default 'other'. */
  family?: CacheFamily;
  /** Skip memory and go to the network (still de-duplicated and cached afterwards). */
  force?: boolean;
};

/**
 * GET through the cache. Resolves with fresh memory at once; with stale memory at once while refreshing
 * in the background (subscribers hear about the refresh); otherwise with the network response.
 */
export function cachedGet<T>(path: string, options: CachedGetOptions = {}): Promise<T> {
  const { family = 'other', force = false, ...apiOptions } = options;
  const entry = entryFor<T>(path, family);
  entry.family = family;
  const { has, fresh } = status(entry);
  if (!force && fresh) return Promise.resolve(entry.data as T);
  const pending = request(path, entry, apiOptions);
  if (!force && has) {
    // Stale-while-revalidate: show what we have, refresh quietly.
    pending.catch(() => undefined);
    return Promise.resolve(entry.data as T);
  }
  return pending;
}

/** Marks every cached path starting with `prefix` stale and wakes its subscribers (they refetch if shown). */
export function invalidate(prefix: string) {
  for (const [path, entry] of entries) {
    if (path === prefix || path.startsWith(prefix)) {
      entry.stale = true;
      notify(path);
    }
  }
}

/** Replaces the cached data for `path` with `next(current)` and wakes subscribers; no request. */
export function update<T>(path: string, next: (current: T | undefined) => T) {
  const entry = entryFor<T>(path, entries.get(path)?.family ?? 'other');
  const data = next(entry.data);
  if (sameData(entry.data, data)) return;
  entry.data = data;
  if (!entry.updatedAt) entry.updatedAt = Date.now();
  notify(path);
}

/** Forgets everything (identity change, tests). */
export function clear() {
  entries.clear();
  for (const path of listeners.keys()) notify(path);
}

/** Re-renders `useCachedGet` callers for `path`; returns the unsubscribe. */
export function subscribe(path: string, listener: Listener): () => void {
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(path);
  };
}

/**
 * Optimistic write: applies `apply` to the cached data at `path` now, runs `commit` (the API call), and on
 * failure puts the previous data back and rethrows, so the caller can toast. Resolves with the API result.
 */
export async function optimistic<T, R>(
  path: string,
  apply: (current: T | undefined) => T,
  commit: () => Promise<R>,
): Promise<R> {
  const entry = entryFor<T>(path, entries.get(path)?.family ?? 'other');
  const previous = entry.data;
  const hadData = entry.updatedAt > 0;
  update<T>(path, apply);
  try {
    return await commit();
  } catch (error) {
    if (hadData) update<T>(path, () => previous as T);
    else {
      entries.delete(path);
      notify(path);
    }
    throw error;
  }
}

// ---- Prefetching -----------------------------------------------------------------------------------
let prefetchInFlight = 0;
let lastPrefetchAt = 0;

/**
 * Warms the cache for a page the visitor is likely to open next (a card under the pointer, the next list
 * page). Rate-limited: skipped when the path is fresh, when PREFETCH_MAX_IN_FLIGHT prefetches are running,
 * or within PREFETCH_MIN_INTERVAL_MS of the last one. Never throws.
 */
export function prefetch(path: string, family: CacheFamily = 'record'): boolean {
  const entry = entries.get(path);
  if (entry && (status(entry).fresh || entry.inFlight)) return false;
  const now = Date.now();
  if (prefetchInFlight >= PREFETCH_MAX_IN_FLIGHT || now - lastPrefetchAt < PREFETCH_MIN_INTERVAL_MS) return false;
  lastPrefetchAt = now;
  prefetchInFlight += 1;
  void request(path, entryFor(path, family), { skipAuthRedirect: true })
    .catch(() => undefined)
    .finally(() => {
      prefetchInFlight -= 1;
    });
  return true;
}

// ---- Wiring ----------------------------------------------------------------------------------------
// Read through the namespace so a test that mocks the api module without these hooks still loads this file.
try {
  apiModule.onApiWrite((_method, path) => {
    const segment = path.replace(/^\/+/, '').split(/[/?]/)[0];
    const prefixes = INVALIDATE_ON_WRITE[segment];
    if (prefixes) prefixes.forEach(invalidate);
    else invalidate(`/${segment}`);
  });
  apiModule.onIdentityChange(() => clear());
} catch {
  /* partial api mock in a unit test */
}

/** The surface the realtime layer (Action Cable, R2) drives; see the file header. */
export const realtime = { invalidate, update };

/** Test hook: a fresh cache and prefetch budget. */
export function resetDataCacheForTests() {
  entries.clear();
  listeners.clear();
  prefetchInFlight = 0;
  lastPrefetchAt = 0;
}
