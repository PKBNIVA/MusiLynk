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

import { Inbox } from 'lucide-react';
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
  it('shows an icon in a dashed box, with children, a custom action element and compact padding', () => {
    show(
      <EmptyState icon={Inbox} title="No projects yet." action={<button type="button">Create one</button>} compact>
        Nothing here <a href="/x">yet</a>.
      </EmptyState>,
    );
    const box = host.querySelector('[data-testid=empty-state]') as HTMLElement;
    expect(box.className).toContain('border-dashed');
    expect(box.className).toContain('py-6');
    expect(box.querySelector('svg[data-scene]')).toBeNull();
    expect(box.querySelector('h2')).toBeNull();
    expect(box.querySelector('p')?.textContent).toBe('No projects yet.');
    expect(box.querySelector('a')?.getAttribute('href')).toBe('/x');
    expect(box.querySelector('button')?.textContent).toBe('Create one');
    show(<EmptyState icon={Inbox} title="Quiet" action={null} className="mt-6" />);
    expect(host.querySelector('button,a')).toBeNull();
    expect(host.querySelector('[data-testid=empty-state]')?.className).toContain('mt-6');
  });
  it('keeps the illustration look, and shrinks it when compact', () => {
    show(<EmptyState scene="search" title="Nothing" compact />);
    const box = host.querySelector('[data-testid=empty-state]') as HTMLElement;
    expect(box.className).not.toContain('border-dashed');
    expect(box.querySelector('svg[data-scene=search]')?.getAttribute('class')).toContain('h-20');
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
