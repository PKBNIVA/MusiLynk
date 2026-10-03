import { apiGet } from './api';
import { formatFromRate, fromRate } from './format';
import { roleNoun } from './seoPages';

// Live proof for the landing page. Only real counts from GET /api/public/stats are shown, and
// only once they mean something; otherwise the page shows how MusiLynk works and what it promises.

export interface PublicStats {
  verifiedProfiles?: number;
  professionals?: number;
  cities?: number;
  openOpportunities?: number;
  urgentRequests?: number;
}

export const loadPublicStats = () =>
  apiGet<PublicStats>('/public/stats', { skipAuthRedirect: true, timeoutMs: 6_000, viaEdge: true });

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

/** Role label in running text: keeps the acronym in "DJ", lowercases the rest. */
export { roleNoun };

/** "Hire a drummer in Mumbai" / "Hire an arranger in Pune". */
export function hireLinkText(label: string, city: string) {
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  return `Hire ${article} ${roleNoun(label)} in ${city}`;
}

/**
 * The "from" price on a landing or hire card is the one every card uses (format.ts): the lowest
 * of the session, show, day and hourly rates that are filled in. Tour-day pay is a different
 * kind of engagement and never counts.
 */
export const lowestRate = fromRate;
export const fromRateText = formatFromRate;

/** Tomorrow, 6 pm local, as a `datetime-local` value: the default "when" of an urgent request. */
export function defaultUrgentStartAt(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** The urgent form, prefilled from the landing band (or a hire page) by query string. */
export function urgentPath(fields: { role?: string; city?: string; startAt?: string }) {
  const query = new URLSearchParams();
  if (fields.role?.trim()) query.set('role', fields.role.trim());
  if (fields.city?.trim()) query.set('city', fields.city.trim());
  if (fields.startAt) query.set('startAt', fields.startAt);
  const qs = query.toString();
  return qs ? `/urgent?${qs}` : '/urgent';
}

/** A line from the platform's own account on The Stage (author type "system", id "musilynk"). */
export interface StageTeaserPost {
  id: string;
  body: string;
  createdAt: string;
}

/**
 * The three newest public-safe posts by MusiLynk itself. The Stage's author route is public; a
 * system post is public by construction. "Welcome Priya, drummer in Mumbai" posts name one new
 * member, so only the aggregate and platform lines (verified, filled requests, roundups) show.
 */
export async function loadStageTeaser(limit = 3): Promise<StageTeaserPost[]> {
  const body = await apiGet<{ posts?: { id: string; body?: string | null; createdAt: string; visibility?: string }[] }>(
    '/stage/authors/system/musilynk/posts',
    { skipAuthRedirect: true, timeoutMs: 6_000, viaEdge: true },
  );
  return (body.posts || [])
    .filter((post) => post.visibility !== 'followers' && post.body?.trim() && !/^Welcome\s/i.test(post.body))
    .slice(0, limit)
    .map((post) => ({ id: post.id, body: post.body!.trim(), createdAt: post.createdAt }));
}
