// Launch switches. Both default OFF: the code ships, but the surfaces stay dark until the Mumbai
// beta shows people want them (VISION.md, launch plan). Set VITE_FEATURE_STAGE=true or
// VITE_FEATURE_RESUMES=true at build time to turn one on.
const on = (value: unknown) => value === 'true' || value === '1';

/** The Stage community feed: nav link, routes and Share-to-Stage buttons. */
export const FEATURE_STAGE = on(import.meta.env?.VITE_FEATURE_STAGE);
/** Career record and resumes: nav item, routes and the resume picker when applying. */
export const FEATURE_RESUMES = on(import.meta.env?.VITE_FEATURE_RESUMES);
