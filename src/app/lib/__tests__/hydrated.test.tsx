import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useHydrated } from '../hydrated';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const seen: boolean[] = [];
function Probe() {
  const hydrated = useHydrated();
  seen.push(hydrated);
  return <p>{hydrated ? 'client' : 'server'}</p>;
}

describe('useHydrated', () => {
  let root: Root | null = null;
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    seen.length = 0;
  });
  it('is false in server markup, false for the hydration render, then true with no hydration error', () => {
    const html = renderToString(<Probe />);
    expect(html).toContain('server');
    const host = document.createElement('div');
    host.innerHTML = html;
    const errors: unknown[] = [];
    act(() => {
      root = hydrateRoot(host, <Probe />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
    expect(host.textContent).toBe('client');
  });
  it('is true from the first render when nothing was pre-rendered', () => {
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<Probe />));
    expect(seen).toEqual([true]);
  });
});
