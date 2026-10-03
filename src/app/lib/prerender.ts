/**
 * Build-time pre-rendering (scripts/prerender-heads.mjs + src/entry-server.tsx): the public pages' first
 * screen is rendered to HTML at build time and hydrated in place by main.tsx. `data-prerendered` on #root
 * names the route the HTML is for: a path ("/pricing") or a pattern for a dynamic shell
 * ("/professionals/:id"). Hydration only happens when the browser's path matches it.
 */

/** True when the HTML pre-rendered for `route` is the right first screen for `pathname`. */
export function prerenderedRouteMatches(route: string | undefined, pathname: string): boolean {
  if (!route) return false;
  const want = route.split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  if (want.length !== have.length) return false;
  return want.every((segment, i) => segment.startsWith(':') || segment === have[i]);
}
