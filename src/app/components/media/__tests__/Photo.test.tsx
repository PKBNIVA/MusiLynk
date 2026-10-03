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
  it('lazy-loads with explicit dimensions, an AVIF source and the WebP srcset fallback', () => {
    show(<Photo src="/img/tabla-hands" alt="Tabla" width={1600} height={1067} sizes="50vw" />);
    const picture = host.querySelector('picture') as HTMLPictureElement;
    expect(picture.className).toBe('contents');
    const source = picture.querySelector('source') as HTMLSourceElement;
    expect(source.getAttribute('type')).toBe('image/avif');
    expect(source.getAttribute('srcset')).toBe(
      '/img/tabla-hands-480.avif 480w, /img/tabla-hands-800.avif 800w, /img/tabla-hands-1200.avif 1200w, /img/tabla-hands-1600.avif 1600w',
    );
    expect(source.getAttribute('sizes')).toBe('50vw');
    const img = picture.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('1600');
    expect(img.getAttribute('height')).toBe('1067');
    expect(img.getAttribute('srcset')).toBe(
      '/img/tabla-hands-480.webp 480w, /img/tabla-hands-800.webp 800w, /img/tabla-hands-1200.webp 1200w, /img/tabla-hands-1600.webp 1600w',
    );
    expect(img.getAttribute('src')).toBe('/img/tabla-hands-1600.webp');
    expect(img.getAttribute('sizes')).toBe('50vw');
    expect(img.getAttribute('alt')).toBe('Tabla');
  });
  it('offers the hero widths in both formats when asked', () => {
    show(<Photo src="/img/v" alt="" width={1600} height={1000} widths={[480, 768, 1200, 1600]} priority />);
    expect(host.querySelector('source')?.getAttribute('srcset')).toBe(
      '/img/v-480.avif 480w, /img/v-768.avif 768w, /img/v-1200.avif 1200w, /img/v-1600.avif 1600w',
    );
    expect(host.querySelector('img')?.getAttribute('fetchpriority')).toBe('high');
  });
  it('is eager and high priority when asked, and passes other URLs through', () => {
    show(<Photo src="https://cdn.test/a.jpg" alt="" width={10} height={10} priority />);
    const img = host.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.jpg');
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(host.querySelector('picture')).toBeNull();
  });
});
