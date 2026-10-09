import { useEffect, useRef, useState } from 'react';
import { cachedGet } from './dataCache';
import type { PortfolioItem } from './apiTypes';

// Listings (candidates, applicants, directory) carry no portfolio, so each card asks for its
// person's first public work sample. GET /public/talent/:id has no side effects (unlike
// /candidates/:id, which writes a "profile view" row). The response goes through the client data
// cache (the same entry the profile page reads, so opening a card's profile needs no request);
// at most a few requests are in flight at once.
// cache: the promise per person, so a card asked twice while loading resolves once.
const cache = new Map<string, Promise<PortfolioItem | null>>();
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];

function pump() {
  while (inFlight < MAX_IN_FLIGHT && waiting.length) waiting.shift()?.();
}

export function loadFirstSample(id: string): Promise<PortfolioItem | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = new Promise<PortfolioItem | null>((resolve) => {
    waiting.push(() => {
      inFlight++;
      cachedGet<{ portfolio?: PortfolioItem[] }>(`/public/talent/${encodeURIComponent(id)}`, { family: 'record' })
        .then((d) => resolve(d.portfolio?.find((x) => x.url) || null))
        .catch(() => {
          cache.delete(id);
          resolve(null);
        })
        .finally(() => {
          inFlight--;
          pump();
        });
    });
    pump();
  });
  cache.set(id, p);
  return p;
}

/** The person's first work sample, fetched once the element is near the viewport. */
export function useFirstSample(id: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ sample: PortfolioItem | null; done: boolean }>({ sample: null, done: false });
  useEffect(() => {
    let live = true;
    const go = () => {
      void loadFirstSample(id).then((sample) => live && setState({ sample, done: true }));
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      go();
      return () => {
        live = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          go();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [id]);
  return { ref, ...state };
}
