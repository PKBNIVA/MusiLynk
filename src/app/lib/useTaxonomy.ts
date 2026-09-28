import { useEffect, useState } from 'react';
import { apiGet } from './api';
import type { Taxonomy } from './apiTypes';

/**
 * The shared job functions and directory role groups (GET /taxonomy, config/search_taxonomy.yml on
 * the API). These copies are only the first-render fallback until the API answers.
 */
export const FUNCTION_AREAS = [
  'Performance',
  'Composition & Songwriting',
  'Music Production',
  'Recording & Studio',
  'Live Sound & Audio',
  'Stage & Technical',
  'Tour & Production Management',
  'Lighting & Video',
  'A&R & Label',
  'Artist Management',
  'Booking & Events',
  'Publishing / Rights / Royalties',
  'Marketing / PR / Content',
  'Music Education',
  'Music Tech',
];

export const TALENT_ROLES = [
  { key: 'performer', label: 'Artists & performers' },
  { key: 'engineer', label: 'Producers & engineers' },
  { key: 'A&R', label: 'A&R & label teams' },
  { key: 'manager', label: 'Managers & artist services' },
  { key: 'live', label: 'Live & touring crews' },
  { key: 'music-tech', label: 'Music-tech professionals' },
];

let cached: Promise<Taxonomy> | null = null;

/** Fetches the taxonomy once per page load (a failed fetch is retried next time). */
export function loadTaxonomy(): Promise<Taxonomy> {
  cached ||= apiGet<Taxonomy>('/taxonomy').catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** For tests: forget the fetched taxonomy. */
export function resetTaxonomy() {
  cached = null;
}

/** The taxonomy once loaded (null before, or if it cannot be loaded). */
export function useTaxonomy(): Taxonomy | null {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  useEffect(() => {
    let live = true;
    loadTaxonomy()
      .then((value) => {
        if (live) setTaxonomy(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return taxonomy;
}

/** Job functions for filters and forms: the API's list, or the built-in copy until it loads. */
export function useFunctionAreas(): string[] {
  return useTaxonomy()?.functionAreas || FUNCTION_AREAS;
}

/** The label for a directory role key ("performer" → "Artists & performers"), or the key itself. */
export function talentRoleLabel(key: string, taxonomy: Taxonomy | null = null): string {
  const roles = taxonomy?.talentRoles || TALENT_ROLES;
  return roles.find((role) => role.key.toLowerCase() === key.toLowerCase())?.label || key;
}
