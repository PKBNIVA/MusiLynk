import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn();
vi.mock('../api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

const sample = { id: 'p1', kind: 'video', title: 'Live set', url: 'https://youtube.com/w' };
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, tries = 50) {
  for (let i = 0; i < tries && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

describe('loadFirstSample', () => {
  beforeEach(() => {
    vi.resetModules();
    apiGet.mockReset();
  });

  it('returns the first sample with a url, caches per person and de-duplicates requests', async () => {
    const { loadFirstSample } = await import('../useFirstSample');
    apiGet.mockResolvedValue({ portfolio: [{ ...sample, url: '' }, sample] });
    const [a, b] = await Promise.all([loadFirstSample('u1'), loadFirstSample('u1')]);
    expect(a).toEqual(sample);
    expect(b).toEqual(sample);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/public/talent/u1');
    await loadFirstSample('u1');
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('resolves null and forgets the person when the request fails, so it can retry later', async () => {
    const { loadFirstSample } = await import('../useFirstSample');
    apiGet.mockRejectedValueOnce(new Error('offline'));
    expect(await loadFirstSample('u2')).toBeNull();
    apiGet.mockResolvedValueOnce({ portfolio: [sample] });
    expect(await loadFirstSample('u2')).toEqual(sample);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('keeps at most four requests in flight and drains the queue', async () => {
    const { loadFirstSample } = await import('../useFirstSample');
    const resolvers: ((v: unknown) => void)[] = [];
    apiGet.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const all = Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => loadFirstSample(id)));
    expect(apiGet).toHaveBeenCalledTimes(4);
    resolvers[0]({ portfolio: [] });
    await until(() => apiGet.mock.calls.length === 5);
    resolvers.slice(1, 5).forEach((r) => r({ portfolio: [] }));
    await until(() => apiGet.mock.calls.length === 6);
    resolvers[5]({ portfolio: [] });
    expect((await all).every((x) => x === null)).toBe(true);
  });
});

describe('useFirstSample', () => {
  const realIO = globalThis.IntersectionObserver;
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.IntersectionObserver = realIO;
  });

  async function mount(id: string) {
    const { useFirstSample } = await import('../useFirstSample');
    const seen: { sample: unknown; done: boolean }[] = [];
    function Probe() {
      const { ref, sample, done } = useFirstSample(id);
      seen.push({ sample, done });
      return <div ref={ref} data-testid="card" />;
    }
    await act(async () => root.render(<Probe />));
    return seen;
  }

  it('loads straight away when IntersectionObserver is unavailable', async () => {
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    vi.resetModules();
    apiGet.mockReset().mockResolvedValue({ portfolio: [sample] });
    const seen = await mount('hook1');
    for (let i = 0; i < 20 && seen.at(-1)?.done !== true; i++) await act(async () => tick());
    expect(seen.at(-1)?.done).toBe(true);
    expect(seen.at(-1)?.sample).toEqual(sample);
  });

  it('waits for the element to come near the viewport, then loads once and disconnects', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: IntersectionObserverCallback = () => {};
    globalThis.IntersectionObserver = class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = () => [];
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
    vi.resetModules();
    apiGet.mockReset().mockResolvedValue({ portfolio: [sample] });
    const seen = await mount('hook2');
    expect(observe).toHaveBeenCalledTimes(1);
    expect(apiGet).not.toHaveBeenCalled();
    await act(async () => {
      callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(apiGet).not.toHaveBeenCalled();
    await act(async () => {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    for (let i = 0; i < 20 && seen.at(-1)?.done !== true; i++) await act(async () => tick());
    expect(seen.at(-1)?.done).toBe(true);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(2);
    root = createRoot(document.createElement('div'));
  });
});
