// Feature flags. The server decides (backend/config/features.yml via Features: enabled, a stable
// percentage of users, an allowlist, and the FEATURE_<NAME> env kill switch); the client only
// reads the answer. Two sources, in order: the signed-in person's own flags from GET /api/me
// (login/register answers carry them too), then the anonymous resolution from GET /api/public/config.
// Before either answers, the build-time VITE_FEATURE_* values below decide first paint
// (VITE_FEATURE_STAGE=false|0 turns the Stage off, VITE_FEATURE_RESUMES=true|1 turns resumes on).
// Kill switch and update path: docs/ops/feature-flags.md.
import { useSyncExternalStore } from 'react';

const on = (value: unknown) => value === 'true' || value === '1';
const off = (value: unknown) => value === 'false' || value === '0';

/** Build-time default for the Stage community feed (first paint only). On unless switched off. */
export const FEATURE_STAGE = !off(import.meta.env?.VITE_FEATURE_STAGE);
/** Build-time default for career record and resumes (first paint only). Off unless switched on. */
export const FEATURE_RESUMES = on(import.meta.env?.VITE_FEATURE_RESUMES);

export type FeatureName = 'stage' | 'resumes';
const BUILD_DEFAULTS: Record<FeatureName, boolean> = { stage: FEATURE_STAGE, resumes: FEATURE_RESUMES };

type Flags = Record<string, boolean> | null;
let userFlags: Flags = null; // GET /api/me for the signed-in person
let serverFlags: Flags = null; // GET /api/public/config, anonymous resolution
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** The signed-in person's flags from /me (or a sign-in answer); null on sign-out. */
export function setUserFeatures(flags: Flags | undefined) {
  userFlags = flags && typeof flags === 'object' ? flags : null;
  notify();
}

/** The anonymous flags from /api/public/config (set by publicConfig.ts). */
export function setServerFeatures(flags: Flags | undefined) {
  serverFlags = flags && typeof flags === 'object' ? flags : null;
  notify();
}

/** Whether `name` is on for this visitor right now: /me, else /api/public/config, else build-time. */
export function featureEnabled(name: FeatureName): boolean {
  if (userFlags && typeof userFlags[name] === 'boolean') return userFlags[name];
  if (serverFlags && typeof serverFlags[name] === 'boolean') return serverFlags[name];
  return BUILD_DEFAULTS[name];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** featureEnabled() in a component, re-rendering when the server answer lands or the session changes. */
export function useFeature(name: FeatureName): boolean {
  return useSyncExternalStore(
    subscribe,
    () => featureEnabled(name),
    () => featureEnabled(name),
  );
}

/** Tests only. */
export function resetFeatures() {
  userFlags = null;
  serverFlags = null;
  notify();
}
