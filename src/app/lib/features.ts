// Launch switches. FEATURE_STAGE now defaults ON: the Stage becomes a living community from
// launch, still behind sign-in (see routes.tsx/ProtectedRoute — there is no public feed). Set
// VITE_FEATURE_STAGE=false or '0' at build time to turn it off. FEATURE_RESUMES stays OFF by
// default until the Mumbai beta shows people want it (docs/MUSILYNK_PLAN.md); set
// VITE_FEATURE_RESUMES=true to turn it on.
const on = (value: unknown) => value === 'true' || value === '1';
const off = (value: unknown) => value === 'false' || value === '0';

/** The Stage community feed: nav link, routes and Share-to-Stage buttons. On by default. */
export const FEATURE_STAGE = !off(import.meta.env?.VITE_FEATURE_STAGE);
/** Career record and resumes: nav item, routes and the resume picker when applying. */
export const FEATURE_RESUMES = on(import.meta.env?.VITE_FEATURE_RESUMES);
