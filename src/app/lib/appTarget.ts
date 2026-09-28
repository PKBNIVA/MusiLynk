// Which site this bundle is (set at build time by VITE_APP_TARGET, see vite.config.ts): the
// public marketplace, or the separate admin site whose only pages are sign-in, the admin console
// and the admin's own account.
// `?.`: the Node smoke tests import api.ts (and so this module) without Vite.
export const IS_ADMIN_SITE = import.meta.env?.VITE_APP_TARGET === 'admin';

/** Where a signed-out visitor to a protected page signs in: the admin site signs in at its root. */
export const signInPath = (role: string) => (IS_ADMIN_SITE ? '/' : `/auth/${role}`);

/** Pages that need a session, so an expired one sends the visitor back to sign in. */
export const PROTECTED_AREA = IS_ADMIN_SITE ? /^\/(admin|account)(\/|$)/ : /^\/(jobseeker|employer)(\/|$)/;

/**
 * The public marketplace's own origin (VITE_PUBLIC_URL, e.g. https://verse.example.app), with any
 * trailing slash removed. The admin bundle never mounts the public routes, so anything that needs
 * to reach one — a link to a listing, a profile, an act — must build an absolute URL to this site
 * instead of a relative path. Empty on the public site itself (relative paths there), and empty if
 * VITE_PUBLIC_URL was never set (falls back to a relative path rather than a broken link).
 */
export const PUBLIC_SITE_URL = (import.meta.env?.VITE_PUBLIC_URL || '').replace(/\/+$/, '');

/** A path (e.g. "/opportunities/123") as the admin site should link to it: absolute on the admin
 * bundle (public routes don't exist there), unchanged everywhere else. */
export const toPublicUrl = (path: string) => (IS_ADMIN_SITE && PUBLIC_SITE_URL ? `${PUBLIC_SITE_URL}${path}` : path);
