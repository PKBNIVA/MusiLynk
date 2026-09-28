// Headline and bio drafts assembled from what a person already told us (roles, city, years,
// credits, genres). No AI: plain templates, so they work for everyone and cost nothing. The
// person can edit the result; the AI suggest buttons stay available next to these fields.

export interface ProfileFacts {
  roles?: string[];
  city?: string;
  years?: number | string | null;
  credits?: string[];
  genres?: string[];
}

export const HEADLINE_LIMIT = 160;
export const BIO_LIMIT = 2_000;

const clean = (values: string[] | undefined) =>
  (values ?? []).map((value) => value.trim()).filter((value, index, all) => value && all.indexOf(value) === index);

/** "Mumbai, Maharashtra" -> "Mumbai". */
export const cityName = (city?: string) => (city ?? '').split(',')[0].trim();

/** A whole number of years from 0 to 80, or null. */
export function yearsOf(years: ProfileFacts['years']): number | null {
  if (years === null || years === undefined || String(years).trim() === '') return null;
  const n = Number(years);
  return Number.isInteger(n) && n >= 0 && n <= 80 ? n : null;
}

const yearsPhrase = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;

/** "a, b and c". */
export function listPhrase(items: string[]) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Roles read naturally mid-sentence ("Session Drummer" -> "session drummer"; "DJ" stays). */
const lowerRole = (role: string) =>
  role
    .split(' ')
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(' ');

/** "Session drummer · Percussionist · Mumbai · 8 years". Empty when no role is known. */
export function buildHeadline(facts: ProfileFacts) {
  const roles = clean(facts.roles).slice(0, 3);
  if (!roles.length) return '';
  const years = yearsOf(facts.years);
  const parts = [...roles, cityName(facts.city), years === null ? '' : yearsPhrase(years)];
  return parts.filter(Boolean).join(' · ').slice(0, HEADLINE_LIMIT);
}

/** A short first-person bio. Empty when no role is known. */
export function buildBio(facts: ProfileFacts) {
  const roles = clean(facts.roles).slice(0, 3);
  if (!roles.length) return '';
  const city = cityName(facts.city);
  const years = yearsOf(facts.years);
  const article = /^[aeiou]/i.test(roles[0]) ? 'an' : 'a';
  let opening = `I'm ${article} ${listPhrase(roles.map(lowerRole))}`;
  if (city) opening += ` based in ${city}`;
  if (years) opening += `, with ${yearsPhrase(years)} of experience`;
  const sentences = [`${opening}.`];
  const genres = clean(facts.genres).slice(0, 4);
  if (genres.length) sentences.push(`I mostly work in ${listPhrase(genres)}.`);
  const credits = clean(facts.credits).slice(0, 3);
  if (credits.length) sentences.push(`Recent work: ${credits.join('; ')}.`);
  sentences.push('Send me your dates and the brief, and I will get back to you.');
  return sentences.join(' ').slice(0, BIO_LIMIT);
}
