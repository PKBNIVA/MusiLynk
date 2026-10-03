import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useMounted } from '../clientOnly';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  return <p>{useMounted() ? 'mounted' : 'first render'}</p>;
}

describe('useMounted', () => {
  let root: Root | null = null;
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
  });
  it('is false in server markup and true after the first effect in the browser', () => {
    expect(renderToString(<Probe />)).toContain('first render');
    const host = document.createElement('div');
    root = createRoot(host);
    act(() => root!.render(<Probe />));
    expect(host.textContent).toBe('mounted');
  });
});
