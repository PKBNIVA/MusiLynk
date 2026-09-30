import { useEffect, useRef, useState } from 'react';
import { apiGet } from './api';
import type { PortfolioItem } from './apiTypes';

// Listings (candidates, applicants, directory) carry no portfolio, so each card asks for its
// person's first public work sample. GET /public/talent/:id has no side effects (unlike
// /candidates/:id, which writes a "profile view" row). Results are cached per person, requests
// are de-duplicated and at most a few are in flight at once.
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
      apiGet<{ portfolio?: PortfolioItem[] }>(`/public/talent/${encodeURIComponent(id)}`)
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
