// The fixed role/city lists behind /hire/:role/:city and /rates/:city — mirrors
// backend/config/seo_pages.yml (Seo::Pages) so a link built here always resolves on the API.

export const SEO_ROLES: ReadonlyArray<readonly [string, string]> = [
  ['drummer', 'Drummer'],
  ['guitarist', 'Guitarist'],
  ['bassist', 'Bassist'],
  ['keyboard-player', 'Keyboard player'],
  ['singer', 'Singer'],
  ['tabla-player', 'Tabla player'],
  ['dhol-player', 'Dhol player'],
  ['violinist', 'Violinist'],
  ['saxophonist', 'Saxophonist'],
  ['dj', 'DJ'],
  ['sound-engineer', 'Sound engineer'],
  ['music-producer', 'Music producer'],
];

// Mumbai first: the launch city, and the one "Popular searches" favors.
export const SEO_CITIES: ReadonlyArray<readonly [string, string]> = [
  ['mumbai', 'Mumbai'],
  ['delhi', 'Delhi'],
  ['gurgaon', 'Gurgaon'],
  ['noida', 'Noida'],
  ['bengaluru', 'Bengaluru'],
  ['pune', 'Pune'],
  ['hyderabad', 'Hyderabad'],
  ['chennai', 'Chennai'],
  ['kolkata', 'Kolkata'],
  ['goa', 'Goa'],
  ['ahmedabad', 'Ahmedabad'],
  ['jaipur', 'Jaipur'],
  ['chandigarh', 'Chandigarh'],
  ['kochi', 'Kochi'],
  ['lucknow', 'Lucknow'],
  ['indore', 'Indore'],
];

const roleLabels = new Map(SEO_ROLES);
const cityNames = new Map(SEO_CITIES);

export const seoRoleLabel = (slug: string) => roleLabels.get(slug.toLowerCase());
export const seoCityName = (slug: string) => cityNames.get(slug.toLowerCase());

export const hirePagePath = (roleSlug: string, citySlug: string) => `/hire/${roleSlug}/${citySlug}`;

/** A role label as a noun in a sentence: lower-case, except the acronym. */
export const roleNoun = (label: string) => (label === 'DJ' ? label : label.toLowerCase());

// The hire and rates pages' <title> and description, used by the pages (usePageMeta) and by the
// build-time heads (scripts/prerender-heads.mjs), so both say the same thing.
export const hirePageTitle = (roleLabel: string, cityName: string) =>
  `Hire a verified ${roleNoun(roleLabel)} in ${cityName} | MusiLynk`;
export const hirePageDescription = (roleLabel: string, cityName: string) =>
  `Browse verified ${roleNoun(roleLabel)}s in ${cityName} with real work you can review. Post an urgent request and hear back within hours, or browse the directory.`;
export const ratesPageTitle = (cityName: string) => `What musicians charge in ${cityName} | MusiLynk`;
export const ratesPageDescription = (cityName: string) =>
  `Median session, show and day rates reported by verified and unverified musicians on MusiLynk in ${cityName}. A guide, not a quote.`;
export const ratesPagePath = (citySlug: string) => `/rates/${citySlug}`;

const article = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a');
const lower = (label: string) => (label === 'DJ' ? label : label.toLowerCase());

/** "Hire a drummer in Mumbai" / "Hire an arranger in Pune" — the landing page's link text. */
export function hireLinkText(label: string, cityName: string) {
  return `Hire ${article(label)} ${lower(label)} in ${cityName}`;
}

/** "Hire a verified drummer in Mumbai" — the hire page's own H1. */
export function hireHeading(label: string, cityName: string) {
  return `Hire ${article(label)} verified ${lower(label)} in ${cityName}`;
}
