import { TOKEN_PAGES, enumerateAdminRoutes, enumeratePublicRoutes, loadIds } from './routes';

// What the index records besides the shots: accounts, the routes found, and the ones that cannot be photographed.

export function plan() {
  const ids = loadIds();
  const publicRoutes = enumeratePublicRoutes();
  const admin = enumerateAdminRoutes();
  return { ids, publicRoutes, admin };
}

/** Routes this run cannot photograph, and why (written into the index). */
function skippedRoutes() {
  const { publicRoutes } = plan();
  const skipped = publicRoutes
    .filter((route) => route.skipReason)
    .map((route) => ({ route: route.pattern, reason: route.skipReason }));
  const redirects = publicRoutes
    .filter((route) => route.redirect)
    .map((route) => ({
      route: route.pattern,
      reason: 'Redirect only: probed for every role (see "redirects"), not photographed.',
    }));
  const tokenPages = TOKEN_PAGES.map((route) => ({
    route,
    reason: 'Needs a one-time token from an email link; photographed without one (its invalid-link state).',
  }));
  return { skipped: [...skipped, ...redirects], tokenPages };
}

export const indexExtra = () => {
  const { ids, publicRoutes, admin } = plan();
  const { skipped, tokenPages } = skippedRoutes();
  return {
    accounts: ids.accounts,
    routes: {
      public: publicRoutes.map((r) => ({
        pattern: r.pattern,
        audience: r.audience,
        redirect: r.redirect ?? false,
        skipReason: r.skipReason ?? null,
      })),
      admin: admin.routes.map((r) => r.pattern),
      adminTabs: admin.tabs,
    },
    skippedRoutes: skipped,
    tokenOnlyRoutes: tokenPages,
  };
};
