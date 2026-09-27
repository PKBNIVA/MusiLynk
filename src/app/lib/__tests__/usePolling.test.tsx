import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNREAD_CHANGED_EVENT, announceUnreadChanged, useVisiblePolling } from '../usePolling';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let visibility: DocumentVisibilityState = 'visible';
let container: HTMLDivElement;
let root: Root;

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

function Poller({ tick, intervalMs = 1_000, enabled = true }: { tick: () => unknown; intervalMs?: number; enabled?: boolean }) {
  useVisiblePolling(tick, intervalMs, enabled);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useVisiblePolling', () => {
  it('polls on the interval while the tab is visible', () => {
    const tick = vi.fn();
    act(() => root.render(<Poller tick={tick} />));
    expect(tick).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('pauses while hidden and polls immediately when visible again', () => {
    const tick = vi.fn();
    act(() => root.render(<Poller tick={tick} />));
    setVisibility('hidden');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(tick).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('does not start a timer when mounted in a hidden tab', () => {
    visibility = 'hidden';
    const tick = vi.fn();
    act(() => root.render(<Poller tick={tick} />));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(tick).not.toHaveBeenCalled();
    // Becoming visible twice does not stack two timers.
    setVisibility('visible');
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('skips a tick that fires while hidden before the timer is cleared', () => {
    const tick = vi.fn();
    act(() => root.render(<Poller tick={tick} />));
    visibility = 'hidden'; // no visibilitychange event yet
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(tick).not.toHaveBeenCalled();
  });

  it('keeps polling after a tick throws and always calls the latest tick', () => {
    const first = vi.fn(() => { throw new Error('offline'); });
    const second = vi.fn();
    act(() => root.render(<Poller tick={first} />));
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(first).toHaveBeenCalledTimes(2);

    act(() => root.render(<Poller tick={second} />));
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('stops when disabled or unmounted', () => {
    const tick = vi.fn();
    act(() => root.render(<Poller tick={tick} enabled={false} />));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(tick).not.toHaveBeenCalled();

    act(() => root.render(<Poller tick={tick} />));
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(tick).toHaveBeenCalledTimes(1);

    act(() => root.render(<Poller tick={tick} enabled={false} />));
    setVisibility('visible');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('restarts with a new interval', () => {
    const tick = vi.fn();
    function Switcher() {
      const [ms, setMs] = useState(1_000);
      (Switcher as any).set = setMs;
      useVisiblePolling(tick, ms);
      return null;
    }
    act(() => root.render(<Switcher />));
    act(() => (Switcher as any).set(5_000));
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(tick).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe('announceUnreadChanged', () => {
  it('dispatches the unread-changed event', () => {
    const listener = vi.fn();
    window.addEventListener(UNREAD_CHANGED_EVENT, listener);
    announceUnreadChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNREAD_CHANGED_EVENT, listener);
  });

  it('is safe where events cannot be dispatched', () => {
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('no window'); });
    expect(() => announceUnreadChanged()).not.toThrow();
  });
});
