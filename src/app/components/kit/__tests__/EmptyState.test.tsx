import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { EmptyState } from '../EmptyState';
import { SCENES, type SceneName } from '../scenes';

describe('EmptyState', () => {
  it('renders illustration, title, hint and a link action', () => {
    show(
      <EmptyState
        scene="inbox"
        title="No applications yet"
        hint="Apply to start"
        action={{ label: 'Find work', to: '/jobseeker/jobs' }}
      />,
    );
    expect(host.querySelector('svg[data-scene=inbox]')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('h2')?.textContent).toBe('No applications yet');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/jobseeker/jobs');
  });
  it('supports onClick actions and omits optional parts', () => {
    const onClick = vi.fn();
    show(<EmptyState scene="stage" title="Hello" action={{ label: 'Go', onClick }} />);
    expect(host.querySelector('p')).toBeNull();
    act(() => (host.querySelector('button') as HTMLButtonElement).click());
    expect(onClick).toHaveBeenCalled();
    show(<EmptyState scene="stage" title="Only" />);
    expect(host.querySelector('button,a')).toBeNull();
  });
  it('has all eight scenes', () => {
    const names = Object.keys(SCENES) as SceneName[];
    expect(names.sort()).toEqual([
      'applicants',
      'bookmark',
      'calendar',
      'inbox',
      'portfolio',
      'search',
      'stage',
      'verified',
    ]);
  });
});
