import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../api', () => ({ apiGet, onApiWrite: () => () => undefined, onIdentityChange: () => () => undefined }));

import { realtime, resetDataCacheForTests } from '../dataCache';
import { TOUCH_PREFETCH_DELAY_MS, useCachedGet, usePrefetchIntent } from '../useCachedGet';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

type Inbox = { conversations: string[] };
let shown: (Inbox | undefined)[] = [];
function Probe({ path }: { path: string }) {
  shown.push(useCachedGet<Inbox>(path, { family: 'inbox' }).data);
  return null;
}

beforeEach(() => {
  apiGet.mockReset();
  resetDataCacheForTests();
  shown = [];
});
afterEach(() => resetDataCacheForTests());

describe('useCachedGet', () => {
  it('refetches a path on screen when it is invalidated (a write or a live update), keeping memory meanwhile', async () => {
    apiGet.mockResolvedValueOnce({ conversations: ['c1'] });
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe, { path: '/conversations' })));
    await flush();
    expect(shown.at(-1)).toEqual({ conversations: ['c1'] });
    expect(apiGet).toHaveBeenCalledTimes(1);

    apiGet.mockResolvedValueOnce({ conversations: ['c2', 'c1'] });
    act(() => realtime.event({ type: 'message', conversationId: 'c2' }));
    expect(shown.at(-1)).toEqual({ conversations: ['c1'] });
    await flush();
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(shown.at(-1)).toEqual({ conversations: ['c2', 'c1'] });

    // An update in place re-renders without a request.
    act(() => realtime.update<Inbox>('/conversations', () => ({ conversations: ['c3'] })));
    await flush();
    expect(shown.at(-1)).toEqual({ conversations: ['c3'] });
    expect(apiGet).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it('a failed refetch keeps the old data and does not loop', async () => {
    apiGet.mockResolvedValueOnce({ conversations: ['c1'] });
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe, { path: '/conversations' })));
    await flush();
    apiGet.mockRejectedValue(new Error('offline'));
    act(() => realtime.invalidate('/conversations'));
    await flush();
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(shown.at(-1)).toEqual({ conversations: ['c1'] });
    act(() => root.unmount());
  });
});

describe('usePrefetchIntent', () => {
  let props: ReturnType<typeof usePrefetchIntent>;
  function Card() {
    props = usePrefetchIntent('/public/talent/1');
    return null;
  }
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockResolvedValue({});
  });
  afterEach(() => vi.useRealTimers());

  it('does not prefetch when a touch moves (scrolling) or ends before the delay', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Card)));
    props.onPointerDown?.({ pointerType: 'touch' } as never);
    props.onPointerMove?.();
    vi.advanceTimersByTime(TOUCH_PREFETCH_DELAY_MS * 3);
    props.onPointerDown?.({ pointerType: 'touch' } as never);
    vi.advanceTimersByTime(TOUCH_PREFETCH_DELAY_MS - 1);
    props.onPointerUp?.();
    vi.advanceTimersByTime(TOUCH_PREFETCH_DELAY_MS * 3);
    expect(apiGet).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('prefetches when a touch rests, and on hover', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Card)));
    props.onPointerDown?.({ pointerType: 'touch' } as never);
    vi.advanceTimersByTime(TOUCH_PREFETCH_DELAY_MS + 1);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(props).not.toHaveProperty('onTouchStart');
    act(() => root.unmount());
  });
});
