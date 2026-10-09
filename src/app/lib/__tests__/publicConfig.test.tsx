import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn();
vi.mock('../api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

async function load() {
  vi.resetModules();
  const mod = await import('../publicConfig');
  mod.resetPublicConfig();
  return mod;
}

const serverBody = (overrides: Record<string, unknown> = {}) => ({
  fees: {
    platformFeePercent: 5,
    feePaidBy: 'hirer',
    minFeeInr: 0,
    gstPercent: 18,
    policyVersion: 2,
    enabled: true,
    cancellation: { fullRefundDays: 10, partialRefundDays: 3, partialRefundPercent: 40 },
    plainEnglish: ['x'],
  },
  plans: [{ code: 'pro', name: 'Pro', monthly: 2999, annual: 29990, trialDays: 7, activePosts: 10, seats: 2, shortlist: 250, bookings: 20 }],
  limits: {
    maxLiveSessions: 5,
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
  catalog: { launchCities: ['Mumbai', 'Pune'], cities: [{ slug: 'pune', name: 'Pune' }], hireRoles: [{ slug: 'dj', label: 'DJ' }] },
  features: { stage: false, resumes: true },
  generatedAt: '2026-10-09T13:00:00Z',
  ...overrides,
});

beforeEach(() => apiGet.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('publicConfig', () => {
  it('starts from the build-time fallback and mirrors the shipped YAML', async () => {
    const { getPublicConfig, publicConfigLoaded, FALLBACK_CONFIG } = await load();
    expect(publicConfigLoaded()).toBe(false);
    expect(getPublicConfig()).toBe(FALLBACK_CONFIG);
    expect(FALLBACK_CONFIG.plans.map((p) => p.code)).toEqual(['free', 'pro', 'studio', 'enterprise']);
    expect(FALLBACK_CONFIG.fees.cancellation).toEqual({ fullRefundDays: 7, partialRefundDays: 2, partialRefundPercent: 50 });
    expect(FALLBACK_CONFIG.limits.maxLiveSessions).toBe(10);
    expect(FALLBACK_CONFIG.catalog.cities[0]).toEqual({ slug: 'mumbai', name: 'Mumbai' });
    expect(FALLBACK_CONFIG.features).toEqual({ stage: true, resumes: false });
  });

  it('loads once through the edge path and replaces the fallback wholesale, flags included', async () => {
    apiGet.mockResolvedValue(serverBody());
    const { loadPublicConfig, getPublicConfig, publicConfigLoaded } = await load();
    const features = await import('../features');
    const [a, b] = await Promise.all([loadPublicConfig(), loadPublicConfig()]);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/public/config', expect.objectContaining({ viaEdge: true, skipAuthRedirect: true }));
    expect(a).toBe(b);
    expect(publicConfigLoaded()).toBe(true);
    expect(getPublicConfig().fees.platformFeePercent).toBe(5);
    expect(getPublicConfig().catalog.launchCities).toEqual(['Mumbai', 'Pune']);
    expect(features.featureEnabled('stage')).toBe(false);
    expect(features.featureEnabled('resumes')).toBe(true);
    await loadPublicConfig();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback when the request fails or the body is not a config, and retries later', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ unrelated: true }).mockResolvedValueOnce(serverBody());
    const { loadPublicConfig, getPublicConfig, publicConfigLoaded, FALLBACK_CONFIG } = await load();
    expect(await loadPublicConfig()).toBe(FALLBACK_CONFIG);
    expect(await loadPublicConfig()).toBe(FALLBACK_CONFIG);
    expect(publicConfigLoaded()).toBe(false);
    await loadPublicConfig();
    expect(publicConfigLoaded()).toBe(true);
    expect(getPublicConfig().plans[0].monthly).toBe(2999);
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  it('usePublicConfig triggers the fetch and re-renders with the server body', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiGet.mockReturnValue(new Promise((r) => (resolve = r)));
    const { usePublicConfig } = await load();
    const Probe = () => <span>{usePublicConfig().fees.platformFeePercent}</span>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.textContent).toBe('0');
    expect(apiGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(serverBody());
      await Promise.resolve();
    });
    expect(container.textContent).toBe('5');
    act(() => root.unmount());
    container.remove();
  });
});
