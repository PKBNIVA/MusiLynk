// The roles filter of Find work lives in the URL as one comma-separated value
// (?roles=Drummer,Vocalist), the same shape the jobs API accepts. A role never contains a comma.

export const MAX_ROLE_CHIPS = 6;

const clean = (role: string) => role.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

/** "Drummer, Vocalist" -> ["Drummer", "Vocalist"] (blank and repeated roles dropped). */
export function splitRoles(csv: string): string[] {
  const seen = new Set<string>();
  return csv
    .split(',')
    .map(clean)
    .filter((role) => {
      const key = role.toLowerCase();
      if (!role || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function joinRoles(roles: string[]): string {
  return splitRoles(roles.map(clean).join(',')).join(',');
}

export function hasRole(csv: string, role: string): boolean {
  const key = clean(role).toLowerCase();
  return splitRoles(csv).some((r) => r.toLowerCase() === key);
}

/** Removes `role` when it is selected, adds it otherwise. */
export function toggleRole(csv: string, role: string): string {
  const key = clean(role).toLowerCase();
  const roles = splitRoles(csv);
  const next = hasRole(csv, role) ? roles.filter((r) => r.toLowerCase() !== key) : [...roles, clean(role)];
  return joinRoles(next);
}

/** The musician's own roles first, then any selected role that is not one of them (a shared link). */
export function roleChips(own: string[], csv: string): string[] {
  const chips = splitRoles(own.join(','));
  for (const role of splitRoles(csv)) if (!hasRole(chips.join(','), role)) chips.push(role);
  return chips;
}
