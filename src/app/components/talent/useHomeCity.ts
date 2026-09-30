import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../lib/authContext';

/** "Mumbai, Maharashtra" → "Mumbai". */
export const homeCityOf = (location?: string | null) =>
  (location || '')
    .split(',')
    .map((part) => part.trim())
    .find(Boolean) || '';

/**
 * Find talent and Book talent open on the signed-in person's own city: once per visit, when the URL
 * names no city, it is added (replacing the history entry, so Back still leaves the page). Choosing
 * "All cities" afterwards removes it and it stays removed. `ready` turns true once that decision is
 * made, so the first search already carries the city instead of running twice.
 */
export function useHomeCityDefault(key: 'location' | 'city', skip = false) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const city = homeCityOf(user?.location);
  const [ready, setReady] = useState(false);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (city && !skip && !params.has(key)) {
      const next = new URLSearchParams(params);
      next.set(key, city);
      setParams(next, { replace: true });
    }
    setReady(true);
  }, [city, skip, key, params, setParams]);
  return { city, ready };
}
