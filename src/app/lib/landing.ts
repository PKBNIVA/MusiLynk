import { apiGet } from './api';

// Live proof for the landing page. Only real counts from GET /api/public/stats are shown, and
// only once they mean something; otherwise the page shows how Verse works and what it promises.

export interface PublicStats {
  verifiedProfiles?: number;
  professionals?: number;
  cities?: number;
  openOpportunities?: number;
  urgentRequests?: number;
}

export const loadPublicStats = () => apiGet<PublicStats>('/public/stats', { skipAuthRedirect: true, timeoutMs: 6_000 });

/** The smallest count worth showing for each stat. */
export const PROOF_THRESHOLDS = { verifiedProfiles: 10, cities: 2, openOpportunities: 5 } as const;

export interface ProofItem {
  key: keyof typeof PROOF_THRESHOLDS;
  value: string;
  label: string;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** The stats worth showing, in order; empty when none are (or the numbers are missing). */
export function proofItems(stats: PublicStats | null | undefined): ProofItem[] {
  if (!stats) return [];
  const format = (n: number) => n.toLocaleString('en-IN');
  const items: ProofItem[] = [];
  const verified = count(stats.verifiedProfiles);
  if (verified >= PROOF_THRESHOLDS.verifiedProfiles)
    items.push({ key: 'verifiedProfiles', value: format(verified), label: 'verified musicians and crew' });
  const cities = count(stats.cities);
  if (cities >= PROOF_THRESHOLDS.cities) items.push({ key: 'cities', value: format(cities), label: 'cities' });
  const open = count(stats.openOpportunities) + count(stats.urgentRequests);
  if (open >= PROOF_THRESHOLDS.openOpportunities)
    items.push({ key: 'openOpportunities', value: format(open), label: 'open gigs and sessions' });
  return items;
}

/** Roles people hire for most, for the "Hire a drummer in Mumbai" links. */
export const HIRE_ROLES = [
  ['drummer', 'Drummer'],
  ['guitarist', 'Guitarist'],
  ['bassist', 'Bassist'],
  ['keyboard player', 'Keyboard player'],
  ['singer', 'Singer'],
  ['tabla player', 'Tabla player'],
  ['dhol player', 'Dhol player'],
  ['violinist', 'Violinist'],
  ['saxophonist', 'Saxophonist'],
  ['DJ', 'DJ'],
  ['sound engineer', 'Sound engineer'],
  ['music producer', 'Music producer'],
] as const;

/** The directory search for one role in one city (the search's own `role` and `location` filters). */
export const hireSearchPath = (role: string, city: string) =>
  `/music-professionals?${new URLSearchParams({ role, location: city }).toString()}`;

/** "Hire a drummer in Mumbai" / "Hire an arranger in Pune". */
export function hireLinkText(label: string, city: string) {
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  return `Hire ${article} ${label === 'DJ' ? label : label.toLowerCase()} in ${city}`;
}
