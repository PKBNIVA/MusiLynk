import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUrlFilters } from '../useUrlFilters';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEYS = ['q', 'location', 'kind'] as const;
type Hook = ReturnType<typeof useUrlFilters<(typeof KEYS)[number]>>;

let container: HTMLDivElement;
let root: Root;
let hook: Hook;
let router: ReturnType<typeof createMemoryRouter>;
let navigate: NavigateFunction;

function Harness() {
  hook = useUrlFilters(KEYS);
  return null;
}

function mount(url: string) {
  router = createMemoryRouter([{ path: '/jobs', element: <Harness /> }], { initialEntries: [url] });
  navigate = router.navigate;
  act(() => root.render(<RouterProvider router={router} />));
}

const search = () => router.state.location.search;

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useUrlFilters', () => {
  it('reads every key from the URL, blank when absent, and ignores other params', () => {
    mount('/jobs?q=vocalist&other=1&kind=');
    expect(hook.values).toEqual({ q: 'vocalist', location: '', kind: '' });
    expect(hook.query).toBe('q=vocalist');
  });

  it('can rewrite the current entry instead of adding one', async () => {
    mount('/jobs');
    act(() => {
      hook.update({ location: 'Pune' }, { replace: true });
    });
    expect(search()).toBe('?location=Pune');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/jobs');
    expect(search()).toBe('?location=Pune');
  });

  it('pushes one history entry per change, so Back undoes it', async () => {
    mount('/jobs?q=vocalist');
    let changed = false;
    act(() => {
      changed = hook.update({ kind: 'gig' });
    });
    expect(changed).toBe(true);
    expect(search()).toBe('?q=vocalist&kind=gig');
    expect(hook.query).toBe('q=vocalist&kind=gig');

    act(() => {
      changed = hook.update({ location: '  Goa ', q: '' });
    });
    expect(search()).toBe('?kind=gig&location=Goa');

    await act(async () => {
      await navigate(-1);
    });
    expect(hook.values).toEqual({ q: 'vocalist', location: '', kind: 'gig' });
  });

  it('reports no change (and pushes nothing) when the values are the same', () => {
    mount('/jobs?q=vocalist');
    const before = router.state.historyAction;
    let changed = true;
    act(() => {
      changed = hook.update({ q: 'vocalist', location: undefined });
    });
    expect(changed).toBe(false);
    expect(router.state.historyAction).toBe(before);
  });

  it('clears only its own keys', () => {
    mount('/jobs?q=vocalist&kind=gig&act=a1');
    let changed = false;
    act(() => {
      changed = hook.clear();
    });
    expect(changed).toBe(true);
    expect(search()).toBe('?act=a1');
    act(() => {
      changed = hook.clear();
    });
    expect(changed).toBe(false);
  });
});
