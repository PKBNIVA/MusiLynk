import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const show = (el: ReactElement) => act(() => root.render(<MemoryRouter>{el}</MemoryRouter>));

import { Photo } from '../Photo';

describe('Photo', () => {
  it('lazy-loads with explicit dimensions and the 800/1600 srcset', () => {
    show(<Photo src="/img/tabla-hands" alt="Tabla" width={1600} height={1067} sizes="50vw" />);
    const img = host.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('1600');
    expect(img.getAttribute('height')).toBe('1067');
    expect(img.getAttribute('srcset')).toBe(
      '/img/tabla-hands-640.webp 640w, /img/tabla-hands-800.webp 800w, /img/tabla-hands-960.webp 960w, /img/tabla-hands-1280.webp 1280w, /img/tabla-hands-1600.webp 1600w',
    );
    expect(img.getAttribute('src')).toBe('/img/tabla-hands-1600.webp');
    expect(img.getAttribute('sizes')).toBe('50vw');
    expect(img.getAttribute('alt')).toBe('Tabla');
  });
  it('is eager and high priority when asked, and passes other URLs through', () => {
    show(<Photo src="https://cdn.test/a.jpg" alt="" width={10} height={10} priority />);
    const img = host.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
  });
});
