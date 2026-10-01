import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn();
vi.mock('../api', () => ({ apiGet: (...args: unknown[]) => apiGet(...args) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

async function mountHook() {
  const { usePaymentMode } = await import('../paymentMode');
  const seen: (string | null)[] = [];
  function Probe() {
    seen.push(usePaymentMode());
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<Probe />);
  });
  return seen;
}

describe('usePaymentMode', () => {
  beforeEach(() => {
    vi.resetModules();
    apiGet.mockReset();
  });

  it('reads how payments run from the billing state, once per page load', async () => {
    apiGet.mockResolvedValue({ paymentMode: 'disabled' });
    const first = await mountHook();
    expect(first.at(-1)).toBe('disabled');
    act(() => root?.unmount());
    root = null;
    await mountHook();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/billing/subscription');
  });

  it('stays unknown when the state cannot be read, and tries again next time', async () => {
    apiGet.mockRejectedValueOnce(new Error('offline'));
    const first = await mountHook();
    expect(first.at(-1)).toBeNull();
    act(() => root?.unmount());
    root = null;
    apiGet.mockResolvedValueOnce({});
    const second = await mountHook();
    expect(second.at(-1)).toBeNull();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
