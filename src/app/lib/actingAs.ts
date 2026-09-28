import { useEffect, useState } from 'react';
import { ACTING_AS_EVENT, apiGet, getActingAs, setActingAs } from './api';
import type { Identity } from './showcase';

/**
 * "One account, many hats": the identities a person can act as (themselves plus the Pages they
 * run) and the current choice. The choice itself lives in api.ts, which sends it on every request.
 */

let identitiesCache: Promise<Identity[]> | null = null;
let cachedFor: string | undefined;

/** GET /me/identities, fetched once per signed-in person (a failure is retried next time). */
export function loadIdentities(userId?: string): Promise<Identity[]> {
  if (cachedFor !== userId) identitiesCache = null;
  cachedFor = userId;
  identitiesCache ||= apiGet<{ identities?: Identity[] }>('/me/identities')
    .then((d) => {
      const list = d.identities || [];
      // A remembered Page the person no longer runs: go back to acting as themselves.
      const current = getActingAs();
      if (current && !list.some((i) => i.key === current)) setActingAs(null);
      return list;
    })
    .catch((error: unknown) => {
      identitiesCache = null;
      throw error;
    });
  return identitiesCache;
}

/** Forgets the fetched identities (sign-out, or a Page was created). */
export function resetIdentities() {
  identitiesCache = null;
}

/** The current acting-as key, kept in sync with switches here and in other tabs. */
export function useActingAsKey(): string | null {
  const [key, setKey] = useState(getActingAs);
  useEffect(() => {
    const sync = () => setKey(getActingAs());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'verse_act_as') sync();
    };
    window.addEventListener(ACTING_AS_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ACTING_AS_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return key;
}

/** The identities (empty until loaded or when signed out) and the one being acted as. */
export function useIdentities(userId?: string) {
  const key = useActingAsKey();
  const [identities, setIdentities] = useState<Identity[]>([]);
  useEffect(() => {
    if (!userId) {
      setIdentities([]);
      return;
    }
    let live = true;
    loadIdentities(userId)
      .then((list) => live && setIdentities(list))
      .catch(() => live && setIdentities([]));
    return () => {
      live = false;
    };
  }, [userId]);
  const current = identities.find((i) => i.key === key) || identities.find((i) => i.type === 'user') || null;
  return { identities, current, actingAsPage: Boolean(key && current && current.type !== 'user') };
}
