import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autocompleteAi,
  isAiPaywallError,
  loadAiPricing,
  loadAiStatus,
  loadAiUsage,
  purchaseAiTopup,
  resetAiPricing,
  resetAiStatus,
  subscribeAiPlus,
  suggestAi,
  useAiStatus,
  useAiTaskEnabled,
  useAiUsage,
  type AiPricingCatalogue,
  type AiStatus,
  type AiUsage,
} from '../ai';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});
import { apiGet, apiPost, ApiError } from '../api';

vi.mock('../razorpayCheckout', async () => {
  const actual = await vi.importActual<typeof import('../razorpayCheckout')>('../razorpayCheckout');
  return { ...actual, openRazorpayCheckout: vi.fn() };
});
import { openRazorpayCheckout } from '../razorpayCheckout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enabledStatus: AiStatus = { enabled: true, tasks: ['post_caption', 'profile_bio'] };
const disabledStatus: AiStatus = { enabled: false, tasks: [] };

let container: HTMLDivElement;
let root: Root;
let seen: { status: AiStatus | null; captionEnabled: boolean; coverLetterEnabled: boolean };
let seenUsage: AiUsage | null;

function Harness() {
  seen = {
    status: useAiStatus(),
    captionEnabled: useAiTaskEnabled('post_caption'),
    coverLetterEnabled: useAiTaskEnabled('cover_letter'),
  };
  return null;
}

beforeEach(() => {
  resetAiStatus();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useAiStatus / useAiTaskEnabled', () => {
  it('starts null, then reflects the fetched status, fetched once', async () => {
    vi.mocked(apiGet).mockResolvedValue(enabledStatus);
    act(() => root.render(<Harness />));
    expect(seen.status).toBeNull();
    expect(seen.captionEnabled).toBe(false);

    await act(async () => {
      await loadAiStatus();
    });
    expect(seen.status).toBe(enabledStatus);
    expect(seen.captionEnabled).toBe(true);
    expect(seen.coverLetterEnabled).toBe(false);

    await loadAiStatus();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/ai/status');
  });

  it('treats a disabled status as every task disabled', async () => {
    vi.mocked(apiGet).mockResolvedValue(disabledStatus);
    act(() => root.render(<Harness />));
    await act(async () => {
      await loadAiStatus();
    });
    expect(seen.captionEnabled).toBe(false);
  });

  it('stays null and retries next time when the fetch fails', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(enabledStatus);
    act(() => root.render(<Harness />));
    await act(async () => {
      await loadAiStatus().catch(() => undefined);
    });
    expect(seen.status).toBeNull();
    await expect(loadAiStatus()).resolves.toBe(enabledStatus);
  });

  it('ignores an answer that arrives after unmount', async () => {
    let resolve!: (value: AiStatus) => void;
    vi.mocked(apiGet).mockReturnValueOnce(new Promise<AiStatus>((res) => (resolve = res)));
    act(() => root.render(<Harness />));
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      resolve(enabledStatus);
      await loadAiStatus();
    });
    expect(seen.status).toBeNull();
  });
});

describe('suggestAi', () => {
  it('posts the task and structured context, never a raw prompt field', async () => {
    vi.mocked(apiPost).mockResolvedValue({ suggestion: 'Great caption!', task: 'post_caption', model: 'claude-haiku' });
    const result = await suggestAi('post_caption', { kind: 'release', notes: 'new single' });
    expect(apiPost).toHaveBeenCalledWith(
      '/ai/suggest',
      { task: 'post_caption', context: { kind: 'release', notes: 'new single' }, regenerate: undefined },
      { signal: undefined },
    );
    expect(result.suggestion).toBe('Great caption!');
  });

  it('forwards an abort signal and the regenerate flag', async () => {
    vi.mocked(apiPost).mockResolvedValue({ suggestion: '', task: 'post_caption', model: 'm' });
    const controller = new AbortController();
    await suggestAi('post_caption', { kind: 'release' }, { signal: controller.signal, regenerate: true });
    expect(apiPost).toHaveBeenCalledWith(
      '/ai/suggest',
      { task: 'post_caption', context: { kind: 'release' }, regenerate: true },
      { signal: controller.signal },
    );
  });

  it('turns a 402 AI_CREDITS_EXHAUSTED into a typed AiPaywallError, enriched from usage and pricing', async () => {
    resetAiPricing();
    const pricing: AiPricingCatalogue = {
      freeCreditsPerMonth: 20,
      aiPlus: { planCode: 'ai_plus', priceInr: 199, creditsPerMonth: 400 },
      planAllowances: { pro: 500, studio: 2000, enterprise: null },
      topups: { small: { priceInr: 99, credits: 150 }, large: { priceInr: 399, credits: 700 } },
      topupExpiresAfterMonths: 12,
      taskCosts: { post_caption: 1 },
    };
    const usage: AiUsage = {
      balance: 0,
      monthlyAllowance: 20,
      usedThisPeriod: 20,
      resetsAt: '2026-10-01',
      plan: 'free',
      recent: [],
    };
    vi.mocked(apiPost).mockRejectedValue(new ApiError("You're out of AI credits.", 402, 'AI_CREDITS_EXHAUSTED'));
    vi.mocked(apiGet).mockImplementation((path: string) => Promise.resolve(path === '/ai/usage' ? usage : pricing));

    const error = await suggestAi('post_caption', { kind: 'release' }).catch((e: unknown) => e);
    expect(isAiPaywallError(error)).toBe(true);
    if (isAiPaywallError(error)) {
      expect(error.code).toBe('AI_CREDITS_EXHAUSTED');
      expect(error.balance).toBe(0);
      expect(error.resetsAt).toBe('2026-10-01');
      expect(error.upgradeOptions?.aiPlus.priceInr).toBe(199);
      expect(error.upgradeOptions?.topups.small.credits).toBe(150);
    }
  });

  it('still surfaces the paywall when the usage/pricing refetch itself fails', async () => {
    resetAiPricing();
    vi.mocked(apiPost).mockRejectedValue(new ApiError('Free AI usage paused.', 402, 'AI_FREE_PAUSED'));
    vi.mocked(apiGet).mockRejectedValue(new Error('offline'));

    const error = await suggestAi('post_caption', { kind: 'release' }).catch((e: unknown) => e);
    expect(isAiPaywallError(error)).toBe(true);
    if (isAiPaywallError(error)) {
      expect(error.code).toBe('AI_FREE_PAUSED');
      expect(error.balance).toBeUndefined();
      expect(error.upgradeOptions).toBeUndefined();
    }
  });

  it('leaves a non-paywall error (e.g. a validation error) as a plain ApiError', async () => {
    vi.mocked(apiPost).mockRejectedValue(new ApiError('Unknown AI task.', 422, 'UNKNOWN_TASK'));
    const error = await suggestAi('post_caption', { kind: 'release' }).catch((e: unknown) => e);
    expect(isAiPaywallError(error)).toBe(false);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe('loadAiUsage / loadAiPricing', () => {
  it('fetches usage from /ai/usage', async () => {
    const usage = {
      balance: 12,
      monthlyAllowance: 20,
      usedThisPeriod: 8,
      resetsAt: '2026-10-01',
      plan: 'free',
      recent: [],
    };
    vi.mocked(apiGet).mockResolvedValue(usage);
    await expect(loadAiUsage()).resolves.toEqual(usage);
    expect(apiGet).toHaveBeenCalledWith('/ai/usage', { signal: undefined });
  });

  it('caches the pricing catalogue for the session', async () => {
    resetAiPricing();
    vi.mocked(apiGet).mockResolvedValue({ freeCreditsPerMonth: 20 });
    await loadAiPricing();
    await loadAiPricing();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe('useAiUsage', () => {
  function UsageHarness({ onReload }: { onReload: (reload: () => void) => void }) {
    const { usage, reload } = useAiUsage();
    seenUsage = usage;
    onReload(reload);
    return null;
  }

  it('loads usage on mount and refetches on reload()', async () => {
    const first: AiUsage = {
      balance: 5,
      monthlyAllowance: 20,
      usedThisPeriod: 15,
      resetsAt: '2026-10-01',
      plan: 'free',
      recent: [],
    };
    const second: AiUsage = { ...first, balance: 4, usedThisPeriod: 16 };
    vi.mocked(apiGet).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    let reload = () => {};
    await act(async () => {
      root.render(<UsageHarness onReload={(r) => (reload = r)} />);
      await Promise.resolve();
    });
    expect(seenUsage).toEqual(first);

    await act(async () => {
      reload();
      await Promise.resolve();
    });
    expect(seenUsage).toEqual(second);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('ignores an incomplete or failed usage response', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ balance: 'nope' }).mockRejectedValueOnce(new Error('offline'));
    let reload = () => {};
    await act(async () => {
      root.render(<UsageHarness onReload={(r) => (reload = r)} />);
      await Promise.resolve();
    });
    expect(seenUsage).toBeNull();
    await act(async () => {
      reload();
      await Promise.resolve();
    });
    expect(seenUsage).toBeNull();
  });
});

describe('purchaseAiTopup / subscribeAiPlus', () => {
  it('resolves without opening checkout when the server activates a mock/free purchase', async () => {
    vi.mocked(apiPost).mockResolvedValue({ checkout: { mode: 'mock' } });
    await expect(purchaseAiTopup('small')).resolves.toBeUndefined();
    expect(apiPost).toHaveBeenCalledWith('/ai/topups', { pack: 'small' });
    expect(openRazorpayCheckout).not.toHaveBeenCalled();
  });

  it('opens Razorpay checkout for a top-up and resolves on success', async () => {
    const checkout = { mode: 'razorpay', keyId: 'k', orderId: 'o', amount: 9900, currency: 'INR' };
    vi.mocked(apiPost).mockResolvedValue({ checkout });
    vi.mocked(openRazorpayCheckout).mockResolvedValue({ status: 'success', response: {} });
    await expect(purchaseAiTopup('small')).resolves.toBeUndefined();
    expect(openRazorpayCheckout).toHaveBeenCalledWith(checkout, { description: 'Verse AI credits top-up' });
  });

  it('rejects when the top-up checkout is dismissed', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      checkout: { mode: 'razorpay', keyId: 'k', orderId: 'o', amount: 1, currency: 'INR' },
    });
    vi.mocked(openRazorpayCheckout).mockResolvedValue({ status: 'dismissed', lastError: 'Card declined' });
    await expect(purchaseAiTopup('small')).rejects.toThrow('Card declined');
  });

  it('rejects with a fallback message when dismissed without an error', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      checkout: { mode: 'razorpay', keyId: 'k', orderId: 'o', amount: 1, currency: 'INR' },
    });
    vi.mocked(openRazorpayCheckout).mockResolvedValue({ status: 'dismissed' });
    await expect(purchaseAiTopup('small')).rejects.toThrow('Checkout was closed.');
  });

  it('subscribes to Verse AI Plus via its own endpoint', async () => {
    vi.mocked(apiPost).mockResolvedValue({ checkout: { mode: 'mock' } });
    await expect(subscribeAiPlus()).resolves.toBeUndefined();
    expect(apiPost).toHaveBeenCalledWith('/ai/plus/subscribe', {});
  });

  it('opens Razorpay checkout for the Plus subscription', async () => {
    const checkout = { mode: 'razorpay', keyId: 'k', orderId: 'o', amount: 19900, currency: 'INR' };
    vi.mocked(apiPost).mockResolvedValue({ checkout });
    vi.mocked(openRazorpayCheckout).mockResolvedValue({ status: 'success', response: {} });
    await subscribeAiPlus();
    expect(openRazorpayCheckout).toHaveBeenCalledWith(checkout, { description: 'Verse AI Plus' });
  });
});

describe('autocompleteAi', () => {
  it('encodes the field and query as a GET request', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      field: 'cities',
      query: 'mum',
      suggestions: [{ value: 'Mumbai', source: 'taxonomy' }],
    });
    const result = await autocompleteAi('cities', 'mum');
    expect(apiGet).toHaveBeenCalledWith('/ai/autocomplete?field=cities&q=mum', { signal: undefined });
    expect(result.suggestions).toEqual([{ value: 'Mumbai', source: 'taxonomy' }]);
  });

  it('encodes special characters in the query', async () => {
    vi.mocked(apiGet).mockResolvedValue({ field: 'skills', query: 'a&b', suggestions: [] });
    await autocompleteAi('skills', 'a&b');
    expect(apiGet).toHaveBeenCalledWith('/ai/autocomplete?field=skills&q=a%26b', { signal: undefined });
  });
});
