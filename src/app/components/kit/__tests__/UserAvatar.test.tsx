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

import { UserAvatar, avatarHue, initialsOf } from '../UserAvatar';

describe('UserAvatar', () => {
  it('shows initials and is decorative by default', () => {
    show(<UserAvatar id="u1" name="Asha Sharma" />);
    const el = host.querySelector('[data-testid=user-avatar]') as HTMLElement;
    expect(el.textContent).toBe('AS');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.width).toBe('40px');
  });
  it('is a labelled image when no name is visible beside it', () => {
    show(<UserAvatar id="u1" name="Asha Sharma" size="xl" decorative={false} />);
    const el = host.querySelector('[role=img]') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Asha Sharma');
    expect(el.style.width).toBe('96px');
  });
  it('has a stable hue per id', () => {
    expect(avatarHue('abc')).toBe(avatarHue('abc'));
    expect(avatarHue('abc')).toBeGreaterThanOrEqual(0);
    expect(avatarHue('abc')).toBeLessThan(360);
    expect(avatarHue('abc')).not.toBe(avatarHue('abd'));
  });
  it('spreads ids that differ in one trailing character (consecutive ids at least 40 degrees apart)', () => {
    const hues = ['u1', 'u2', 'u3'].map(avatarHue);
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(gap(hues[0], hues[1])).toBeGreaterThanOrEqual(40);
    expect(gap(hues[1], hues[2])).toBeGreaterThanOrEqual(40);
  });
  it('handles one-word and empty names', () => {
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('a b c')).toBe('AC');
  });
  it('prefers a photo, then generated art, then initials', () => {
    show(<UserAvatar id="u1" name="Asha Sharma" photoUrl="https://cdn.test/a.webp" art demo />);
    let el = host.querySelector('[data-testid=user-avatar]') as HTMLElement;
    expect(el.getAttribute('data-layer')).toBe('photo');
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.test/a.webp');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('width')).toBe('40');
    show(<UserAvatar id="u1" name="Asha Sharma" art />);
    el = host.querySelector('[data-testid=user-avatar]') as HTMLElement;
    expect(el.getAttribute('data-layer')).toBe('art');
    show(<UserAvatar id="u1" name="Asha Sharma" demo genres={['Jazz']} />);
    expect(host.querySelector('[data-layer=art]')).not.toBeNull();
    show(<UserAvatar id="u1" name="Asha Sharma" photoUrl={null} />);
    expect(host.querySelector('[data-layer=initials]')?.textContent).toBe('AS');
  });
  it('falls back when the photo does not load, and retries when the URL changes', () => {
    show(<UserAvatar id="u1" name="Asha Sharma" photoUrl="https://cdn.test/broken.webp" />);
    act(() => {
      host.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    expect(host.querySelector('[data-layer=initials]')?.textContent).toBe('AS');
    show(<UserAvatar id="u1" name="Asha Sharma" photoUrl="https://cdn.test/fixed.webp" />);
    expect(host.querySelector('[data-layer=photo]')).not.toBeNull();
  });
});
