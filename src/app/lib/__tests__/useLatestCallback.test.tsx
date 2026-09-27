import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLatestCallback } from '../useLatestCallback';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useLatestCallback', () => {
  it('keeps one identity across renders, so an effect listing it runs once', () => {
    const identities = new Set<unknown>();
    let effectRuns = 0;
    let setQuery: (value: string) => void = () => undefined;

    function SearchPage() {
      const [query, update] = useState('');
      setQuery = update;
      const load = useLatestCallback(() => query);
      identities.add(load);
      useEffect(() => {
        effectRuns += 1;
        load();
      }, [load]);
      return null;
    }

    act(() => root.render(<SearchPage />));
    act(() => setQuery('d'));
    act(() => setQuery('drummer'));

    expect(identities.size).toBe(1);
    expect(effectRuns).toBe(1);
  });

  it('runs the latest function with the arguments it is given', () => {
    let call: (suffix: string) => string = () => '';
    let setQuery: (value: string) => void = () => undefined;

    function SearchPage() {
      const [query, update] = useState('guitar');
      setQuery = update;
      call = useLatestCallback((suffix: string) => `${query}${suffix}`);
      return null;
    }

    act(() => root.render(<SearchPage />));
    const first = call;
    expect(first('!')).toBe('guitar!');

    act(() => setQuery('bass'));
    // The identity captured before the update still sees the newest state.
    expect(first('?')).toBe('bass?');
  });
});
