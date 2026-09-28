// Which site this bundle is (set at build time by VITE_APP_TARGET, see vite.config.ts): the
// public marketplace, or the separate admin site whose only pages are sign-in, the admin console
// and the admin's own account.
// `?.`: the Node smoke tests import api.ts (and so this module) without Vite.
export const IS_ADMIN_SITE = import.meta.env?.VITE_APP_TARGET === 'admin';

/** Where a signed-out visitor to a protected page signs in: the admin site signs in at its root. */
export const signInPath = (role: string) => (IS_ADMIN_SITE ? '/' : `/auth/${role}`);

/** Pages that need a session, so an expired one sends the visitor back to sign in. */
export const PROTECTED_AREA = IS_ADMIN_SITE ? /^\/(admin|account)(\/|$)/ : /^\/(jobseeker|employer)(\/|$)/;
