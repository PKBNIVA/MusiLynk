import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pagePath, usePagedList, type PageMeta } from '../usePagedList';

const { identityListeners } = vi.hoisted(() => ({ identityListeners: new Set<() => void>() }));
vi.mock('../api', () => ({
  apiGet: vi.fn(),
  onApiWrite: () => () => undefined,
  onIdentityChange: (l: () => void) => (identityListeners.add(l), () => identityListeners.delete(l)),
}));
import { apiGet } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Pro = { id: string };
type Page = PageMeta & { talent?: Pro[]; extra?: string };
type Hook = ReturnType<typeof usePagedList<Pro, Page>>;

let container: HTMLDivElement;
let root: Root;
let hook: Hook;

function Harness({ fetchPage }: { fetchPage?: (path: string) => Promise<Page> }) {
  hook = usePagedList<Pro, Page>({
    path: '/public/talent',
    pick: (page) => page.talent,
    noun: 'professionals',
    fetchPage,
  });
  return null;
}

const pros = (...ids: string[]) => ids.map((id) => ({ id }));

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('pagePath', () => {
  it('adds the query and cursor only when present', () => {
    expect(pagePath('/acts', '')).toBe('/acts');
    expect(pagePath('/acts', 'q=band')).toBe('/acts?q=band');
    expect(pagePath('/acts', '', 'c1')).toBe('/acts?cursor=c1');
    expect(pagePath('/acts', 'q=band', 'c1')).toBe('/acts?q=band&cursor=c1');
  });
});

describe('usePagedList', () => {
  it('keeps how the query was read and the raw first page', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      talent: pros('a'),
      total: 1,
      interpretedAs: ['guitarst', 'guitarist'],
      matchMode: 'corrected',
      didYouMean: 'guitarist',
      extra: 'kept',
    });
    act(() => root.render(<Harness fetchPage={fetchPage} />));
    await act(async () => {
      await hook.search('q=guitarst');
    });
    expect(fetchPage).toHaveBeenCalledWith('/public/talent?q=guitarst');
    expect(hook.items).toEqual(pros('a'));
    expect(hook.meta).toEqual({
      interpretedAs: ['guitarst', 'guitarist'],
      matchMode: 'corrected',
      didYouMean: 'guitarist',
    });
    expect(hook.first?.extra).toBe('kept');
  });

  it('names the rows in error messages and uses the API client by default', async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce('boom')
      .mockResolvedValueOnce({ talent: pros('a'), nextCursor: 'n' });
    act(() => root.render(<Harness />));
    let message: string | null = null;
    await act(async () => {
      message = await hook.search('');
    });
    expect(message).toBe('Unable to load professionals');
    expect(hook.error).toBe('Unable to load professionals');

    await act(async () => {
      await hook.search('');
    });
    vi.mocked(apiGet).mockRejectedValueOnce(new Error(''));
    await act(async () => {
      await hook.loadMore();
    });
    expect(apiGet).toHaveBeenLastCalledWith('/public/talent?cursor=n');
    expect(hook.moreError).toBe('Unable to load more professionals');
  });

  it('treats a page without rows as empty', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ talent: pros('a'), nextCursor: 'n', total: 2 })
      .mockResolvedValueOnce({ nextCursor: null });
    act(() => root.render(<Harness fetchPage={fetchPage} />));
    await act(async () => {
      await hook.search('');
    });
    let first: number | null = 0;
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBeNull();
    expect(hook.items).toEqual(pros('a'));
    expect(hook.total).toBe(2);
    expect(hook.hasMore).toBe(false);
  });

  it('forgets remembered lists on an identity change', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ talent: pros('mine'), total: 1 })
      .mockResolvedValueOnce({ talent: pros('theirs'), total: 1 });
    act(() => root.render(<Harness fetchPage={fetchPage} />));
    await act(async () => {
      await hook.search('q=a');
    });
    expect(hook.items).toEqual(pros('mine'));
    act(() => identityListeners.forEach((l) => l()));
    // Another identity opens the same query: nothing remembered is shown while it loads.
    act(() => root.render(<Harness key="again" fetchPage={fetchPage} />));
    let pending!: Promise<string | null>;
    act(() => {
      pending = hook.search('q=a');
    });
    expect(hook.items).toEqual([]);
    await act(async () => {
      await pending;
    });
    expect(hook.items).toEqual(pros('theirs'));
  });
});
