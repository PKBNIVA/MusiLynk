type PersonFields = {
  headline?: string | null;
  roles?: string[] | null;
  genres?: string[] | null;
  location?: string | null;
};

/**
 * What to print under a person's name. `primary` is the headline (or the roles when there is none);
 * `secondary` lists roles, genres and the location that the primary text does not already say.
 */
export function personLines({ headline, roles, genres, location }: PersonFields): {
  primary: string;
  secondary: string[];
} {
  const roleList = (roles || []).filter(Boolean);
  const primary = (headline || '').trim() || roleList.join(', ');
  const seen = primary.toLowerCase();
  const secondary = [...roleList, ...(genres || []), location || '']
    .map((x) => x.trim())
    .filter((x) => x && !seen.includes(x.toLowerCase()));
  return { primary, secondary: [...new Set(secondary)] };
}

/** True when `text` already names `place` (a headline such as "Session drummer · Mumbai"), so the city is not printed a second time. */
export function mentionsPlace(text: string | null | undefined, place: string | null | undefined): boolean {
  const city = (place || '').trim().toLowerCase();
  return city !== '' && (text || '').toLowerCase().includes(city);
}
