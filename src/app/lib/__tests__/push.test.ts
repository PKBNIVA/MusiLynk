import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
import { apiDelete, apiGet, apiPost, apiPut } from '../api';

type PushModule = typeof import('../push');
const load = async (): Promise<PushModule> => {
  vi.resetModules();
  return import('../push');
};

const define = (target: object, key: string, value: unknown) =>
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
const remove = (target: object, key: string) => {
  delete (target as Record<string, unknown>)[key];
};

let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> };
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let serviceWorker: {
  getRegistration: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  ready: Promise<unknown>;
};
let notification: { permission: string; requestPermission: ReturnType<typeof vi.fn> };

const setUa = (ua: string, platform = 'Linux x86_64', touch = 0) => {
  define(navigator, 'userAgent', ua);
  define(navigator, 'platform', platform);
  define(navigator, 'maxTouchPoints', touch);
  define(navigator, 'standalone', undefined);
};

beforeEach(() => {
  vi.clearAllMocks();
  subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: {} }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  pushManager = {
    getSubscription: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const reg = { pushManager };
  serviceWorker = {
    getRegistration: vi.fn().mockResolvedValue(reg),
    register: vi.fn().mockResolvedValue(reg),
    ready: Promise.resolve(reg),
  };
  notification = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') };
  setUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/130');
  define(navigator, 'serviceWorker', serviceWorker);
  define(window, 'PushManager', class {});
  define(window, 'Notification', notification);
  define(window, 'matchMedia', (q: string) => ({ matches: false, media: q }));
});

afterEach(() => {
  remove(navigator, 'serviceWorker');
  remove(window, 'PushManager');
  remove(window, 'Notification');
});

describe('getPushConfig', () => {
  it('fetches once and caches the result', async () => {
    const { getPushConfig } = await load();
    vi.mocked(apiGet).mockResolvedValue({ enabled: true, publicKey: 'k' });
    expect(await getPushConfig()).toEqual({ enabled: true, publicKey: 'k' });
    await getPushConfig();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/push/config', { skipAuthRedirect: true });
  });

  it('treats a failed request as off', async () => {
    const { getPushConfig } = await load();
    vi.mocked(apiGet).mockRejectedValue(new Error('down'));
    expect(await getPushConfig()).toEqual({ enabled: false, publicKey: null });
  });
});

describe('pushSupport', () => {
  it('is ready when the APIs exist and permission is not denied', async () => {
    const { pushSupport } = await load();
    expect(pushSupport()).toBe('ready');
  });

  it('is blocked when permission was denied', async () => {
    const { pushSupport } = await load();
    notification.permission = 'denied';
    expect(pushSupport()).toBe('blocked');
  });

  it('is unsupported without the push APIs', async () => {
    const { pushSupport } = await load();
    remove(window, 'PushManager');
    expect(pushSupport()).toBe('unsupported');
  });

  it('asks iPhone and iPad users to install the app first', async () => {
    const { pushSupport } = await load();
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(pushSupport()).toBe('needs-install');
  });

  it('detects iPadOS posing as a Mac by its touch points', async () => {
    const { pushSupport } = await load();
    setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5);
    expect(pushSupport()).toBe('needs-install');
    setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 0);
    expect(pushSupport()).toBe('ready');
  });

  it('is ready on iOS once installed (display-mode or navigator.standalone)', async () => {
    const { pushSupport } = await load();
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    define(window, 'matchMedia', () => ({ matches: true }));
    expect(pushSupport()).toBe('ready');
    define(window, 'matchMedia', undefined);
    expect(pushSupport()).toBe('needs-install');
    define(navigator, 'standalone', true);
    expect(pushSupport()).toBe('ready');
  });
});

describe('isSubscribedHere', () => {
  it('is false without the APIs', async () => {
    const { isSubscribedHere } = await load();
    remove(navigator, 'serviceWorker');
    expect(await isSubscribedHere()).toBe(false);
  });

  it('reflects the browser subscription', async () => {
    const { isSubscribedHere } = await load();
    expect(await isSubscribedHere()).toBe(false);
    pushManager.getSubscription.mockResolvedValue(subscription);
    expect(await isSubscribedHere()).toBe(true);
  });

  it('is false with no registration or when the lookup throws', async () => {
    const { isSubscribedHere } = await load();
    serviceWorker.getRegistration.mockResolvedValue(undefined);
    expect(await isSubscribedHere()).toBe(false);
    serviceWorker.getRegistration.mockRejectedValue(new Error('x'));
    expect(await isSubscribedHere()).toBe(false);
  });
});

describe('enablePush', () => {
  const config = (over = {}) => vi.mocked(apiGet).mockResolvedValue({ enabled: true, publicKey: 'AQAB_-8', ...over });

  it('is unavailable when push is off, keyless or unsupported', async () => {
    let m = await load();
    config({ enabled: false });
    expect(await m.enablePush()).toBe('unavailable');
    m = await load();
    config({ publicKey: null });
    expect(await m.enablePush()).toBe('unavailable');
    m = await load();
    config();
    remove(window, 'Notification');
    expect(await m.enablePush()).toBe('unavailable');
    expect(notification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports denied without subscribing', async () => {
    const { enablePush } = await load();
    config();
    notification.requestPermission.mockResolvedValue('denied');
    expect(await enablePush()).toBe('denied');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes with the decoded base64url key and tells the server', async () => {
    const { enablePush } = await load();
    config();
    expect(await enablePush()).toBe('enabled');
    const options = pushManager.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
    // 'AQAB_-8' -> padded 'AQAB/+8=' -> 01 00 01 ff ef
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual([1, 0, 1, 255, 239]);
    expect(apiPost).toHaveBeenCalledWith('/push/subscriptions', subscription.toJSON());
  });

  it('registers the worker when none exists and reuses an existing subscription', async () => {
    const { enablePush } = await load();
    config();
    serviceWorker.getRegistration.mockResolvedValue(undefined);
    pushManager.getSubscription.mockResolvedValue(subscription);
    expect(await enablePush()).toBe('enabled');
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('disablePush', () => {
  it('does nothing when there is no subscription', async () => {
    const { disablePush } = await load();
    await disablePush();
    expect(apiDelete).not.toHaveBeenCalled();
    serviceWorker.getRegistration.mockResolvedValue(undefined);
    await disablePush();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('removes the subscription on the server, then in the browser', async () => {
    const { disablePush } = await load();
    pushManager.getSubscription.mockResolvedValue(subscription);
    await disablePush();
    expect(apiDelete).toHaveBeenCalledWith('/push/subscriptions', {
      body: JSON.stringify({ endpoint: 'https://push.example/abc' }),
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('preferences', () => {
  it('reads and saves through the API', async () => {
    const { getPushPreferences, savePushPreferences } = await load();
    await getPushPreferences();
    expect(apiGet).toHaveBeenCalledWith('/push/preferences');
    await savePushPreferences({ urgent: false });
    expect(apiPut).toHaveBeenCalledWith('/push/preferences', { preferences: { urgent: false } });
  });
});
