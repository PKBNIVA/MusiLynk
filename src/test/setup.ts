import { beforeEach } from 'vitest';

// The client data cache (src/app/lib/dataCache.ts) and the remembered lists (usePagedList.ts) are module
// state that would otherwise leak between tests in one file. Imported lazily so a test file's vi.mock of
// the api module is already in place when the cache module loads.
beforeEach(async () => {
  try {
    const [cache, lists] = await Promise.all([import('../app/lib/dataCache'), import('../app/lib/usePagedList')]);
    cache.resetDataCacheForTests();
    lists.forgetListsForTests();
  } catch {
    /* a test file whose api mock cannot load the cache module has no cache state to reset */
  }
});
