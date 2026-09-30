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
  it('handles one-word and empty names', () => {
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('a b c')).toBe('AC');
  });
});
