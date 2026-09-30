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

import { CoverArt } from '../CoverArt';
import { ArtAvatar } from '../ArtAvatar';

describe('CoverArt', () => {
  it('draws the same picture for the same seed and a different one otherwise', () => {
    show(<CoverArt seed="job-1" kind="gig" genres={['Jazz']} size={160} />);
    const first = host.innerHTML.replace(/id="[^"]+"|url\(#[^)]+\)/g, '');
    show(<CoverArt seed="job-1" kind="gig" genres={['Jazz']} size={160} />);
    expect(host.innerHTML.replace(/id="[^"]+"|url\(#[^)]+\)/g, '')).toBe(first);
    show(<CoverArt seed="job-2" kind="gig" genres={['Jazz']} size={160} />);
    expect(host.innerHTML.replace(/id="[^"]+"|url\(#[^)]+\)/g, '')).not.toBe(first);
  });
  it('renders 48 bars, the palette name, and is decorative unless labelled', () => {
    show(<CoverArt seed="a" genres={['Bhajan']} size={64} />);
    const el = host.querySelector('[data-testid=cover-art]') as HTMLElement;
    expect(el.getAttribute('data-palette')).toBe('devotional');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelectorAll('g rect')).toHaveLength(48);
    show(<CoverArt seed="a" size={64} label="Cover" bars={12} />);
    expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Cover');
    expect(host.querySelectorAll('g rect')).toHaveLength(12);
  });
  it('shows the kind glyph only when there is room, supports fill and rounding', () => {
    show(<CoverArt seed="a" kind="session" size={48} />);
    expect(host.querySelector('[data-glyph]')).toBeNull();
    show(<CoverArt seed="a" kind="session" size={120} rounded />);
    expect(host.querySelector('[data-glyph=session]')).not.toBeNull();
    show(<CoverArt seed="a" kind="tour" size={400} rounded="full" />);
    expect((host.firstElementChild as HTMLElement).style.borderRadius).toBe('9999px');
    show(<CoverArt seed="a" kind="tour" size="fill" rounded />);
    const el = host.querySelector('[data-testid=cover-art]') as HTMLElement;
    expect(el.style.width).toBe('100%');
    expect(host.querySelector('[data-glyph=tour]')).not.toBeNull();
  });
});

describe('ArtAvatar', () => {
  it('is a circle with a faint monogram', () => {
    show(<ArtAvatar id="u1" name="Asha Sharma" size="lg" />);
    const el = host.querySelector('[data-testid=user-avatar]') as HTMLElement;
    expect(el.getAttribute('data-layer')).toBe('art');
    expect(el.style.width).toBe('56px');
    expect(el.textContent).toBe('AS');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('g rect')).toHaveLength(16);
  });
  it('can be a labelled image', () => {
    show(<ArtAvatar id="u1" name="Asha Sharma" decorative={false} />);
    expect(host.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Asha Sharma');
  });
});
