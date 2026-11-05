// Business settings served by GET /api/public/config (backend PublicConfig): fees and cancellation
// rules, plans, limits, catalogue lists and the anonymous feature flags. One fetch per page load,
// kept in memory; until it answers (or when it fails) pages read FALLBACK_CONFIG, a build-time
// copy of backend/config/*.yml for first paint only — the server body replaces it wholesale.
// Loaded lazily (dynamic import from authContext) so nothing here is in the entry chunk.
// Update path for the values: docs/engineering/SETTINGS.md.
import { useSyncExternalStore } from 'react';
import { apiGet } from './api';
import { setServerFeatures } from './features';

export interface PublicConfigPlan {
  code: string;
  name: string;
  monthly: number | null;
  annual: number | null;
  trialDays: number;
  activePosts: number;
  seats: number;
  shortlist: number;
  bookings: number;
}

export interface PublicConfig {
  fees: {
    platformFeePercent: number;
    feePaidBy: 'hirer' | 'split';
    minFeeInr: number;
    gstPercent: number;
    policyVersion: number;
    enabled: boolean;
    cancellation: { fullRefundDays: number; partialRefundDays: number; partialRefundPercent: number };
    plainEnglish: string[];
  };
  plans: PublicConfigPlan[];
  limits: {
    maxLiveSessions: number;
    publicPortfolioItemsShown: number;
    portfoliosPerOwner: number;
    listPageSize: number;
    listMaxPageSize: number;
    adminPageSize: number;
    adminMaxPageSize: number;
    searchMaxResults: number;
    messageMaxLength: number;
    jobMaxRoles: number;
    pushSubscriptionsPerUser: number;
  };
  catalog: {
    launchCities: string[];
    cities: { slug: string; name: string }[];
    hireRoles: { slug: string; label: string }[];
  };
  features: Record<string, boolean>;
  generatedAt?: string;
}

/** Build-time copy of backend/config/{bookings,plans,limits,catalog,features}.yml for first paint. */
export const FALLBACK_CONFIG: PublicConfig = {
  fees: {
    platformFeePercent: 0,
    feePaidBy: 'hirer',
    minFeeInr: 0,
    gstPercent: 18,
    policyVersion: 1,
    enabled: false,
    cancellation: { fullRefundDays: 7, partialRefundDays: 2, partialRefundPercent: 50 },
    plainEnglish: [],
  },
  plans: [
    {
      code: 'free',
      name: 'Free',
      monthly: 0,
      annual: 0,
      trialDays: 0,
      activePosts: 1,
      seats: 1,
      shortlist: 20,
      bookings: 2,
    },
    {
      code: 'pro',
      name: 'Pro',
      monthly: 2499,
      annual: 24990,
      trialDays: 14,
      activePosts: 10,
      seats: 2,
      shortlist: 250,
      bookings: 20,
    },
    {
      code: 'studio',
      name: 'Studio',
      monthly: 5999,
      annual: 59990,
      trialDays: 14,
      activePosts: 50,
      seats: 8,
      shortlist: 2000,
      bookings: 100,
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      monthly: null,
      annual: null,
      trialDays: 0,
      activePosts: 9999,
      seats: 999,
      shortlist: 99999,
      bookings: 9999,
    },
  ],
  limits: {
    maxLiveSessions: 10,
    publicPortfolioItemsShown: 8,
    portfoliosPerOwner: 20,
    listPageSize: 30,
    listMaxPageSize: 100,
    adminPageSize: 50,
    adminMaxPageSize: 100,
    searchMaxResults: 60,
    messageMaxLength: 5000,
    jobMaxRoles: 6,
    pushSubscriptionsPerUser: 10,
  },
  catalog: {
    launchCities: ['Mumbai'],
    cities: [
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
    ].map(([slug, name]) => ({ slug, name })),
    hireRoles: [
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
    ].map(([slug, label]) => ({ slug, label })),
  },
  features: { stage: true, resumes: false },
};

let current: PublicConfig = FALLBACK_CONFIG;
let loaded = false;
let inflight: Promise<PublicConfig> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** The current settings: the server's once loaded, FALLBACK_CONFIG before that. */
export const getPublicConfig = () => current;
/** True once a server body has replaced the build-time fallback. */
export const publicConfigLoaded = () => loaded;

export function subscribePublicConfig(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const looksLikeConfig = (d: unknown): d is PublicConfig =>
  !!d && typeof d === 'object' && 'fees' in d && 'plans' in d && 'limits' in d && 'features' in d;

/** Replace the settings (the server body, or a test fixture) and tell subscribers and the flags. */
export function setPublicConfig(next: PublicConfig) {
  current = next;
  loaded = true;
  setServerFeatures(next.features);
  notify();
}

/** Fetch once per page load; a failure keeps the fallback and lets a later call retry. */
export function loadPublicConfig(): Promise<PublicConfig> {
  if (loaded) return Promise.resolve(current);
  if (inflight) return inflight;
  inflight = apiGet<unknown>('/public/config', { skipAuthRedirect: true, viaEdge: true, timeoutMs: 6_000 })
    .then((d) => {
      if (looksLikeConfig(d)) setPublicConfig(d);
      return current;
    })
    .catch(() => current)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The settings in a component; triggers the one fetch and re-renders when it lands. */
export function usePublicConfig(): PublicConfig {
  const config = useSyncExternalStore(subscribePublicConfig, getPublicConfig, getPublicConfig);
  if (!loaded && !inflight) void loadPublicConfig();
  return config;
}

/** Tests only: back to the build-time fallback. */
export function resetPublicConfig() {
  current = FALLBACK_CONFIG;
  loaded = false;
  inflight = null;
  setServerFeatures(null);
}
