/**
 * How long each kind of GET response stays fresh in the client data cache (src/app/lib/dataCache.ts).
 * One place on purpose: change a number here, nowhere else (docs/ops/web-performance.md, "Client data cache").
 *
 * Fresh = served from memory without a request. Stale (older than the TTL) = served from memory at once
 * while a request refreshes it in the background (stale-while-revalidate). Entries older than MAX_AGE_MS
 * are dropped. A TTL of 0 means "always revalidate, but still show what we have first".
 */
export type CacheFamily = 'list' | 'record' | 'inbox' | 'thread' | 'unread' | 'notifications' | 'bookings' | 'other';

export const CACHE_TTL_MS: Record<CacheFamily, number> = {
  list: 60_000, // talent, acts, jobs, search pages: back-navigation shows the list instantly for a minute
  record: 120_000, // a profile, act or opportunity page
  inbox: 0, // the conversation list polls every 10 s; the cache only removes the blank while it loads
  thread: 0, // messages in a thread, same
  unread: 0, // unread badges, same
  notifications: 15_000,
  bookings: 15_000,
  other: 30_000,
};

/** Nothing older than this is ever shown, however stale-while-revalidate would like to. */
export const CACHE_MAX_AGE_MS = 30 * 60_000;

/** Prefetching on hover/focus/touch: at most this many in flight, and this long between two starts. */
export const PREFETCH_MAX_IN_FLIGHT = 2;
export const PREFETCH_MIN_INTERVAL_MS = 150;

/**
 * Which cached paths a successful write (POST/PUT/PATCH/DELETE) makes stale, by the first segment of the
 * written path. Keys are matched as prefixes of the cached GET path.
 */
export const INVALIDATE_ON_WRITE: Record<string, readonly string[]> = {
  conversations: ['/conversations', '/notifications/unread'],
  messages: ['/conversations', '/notifications/unread'],
  bookings: ['/bookings', '/notifications/unread'],
  notifications: ['/notifications'],
  blocks: ['/conversations'],
  reports: [],
  profile: ['/public/talent', '/me'],
  acts: ['/public/acts', '/acts'],
  jobs: ['/jobs'],
  applications: ['/jobs', '/applications'],
};
