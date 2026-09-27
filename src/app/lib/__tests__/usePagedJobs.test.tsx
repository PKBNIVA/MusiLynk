import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePagedJobs, type JobPage } from '../usePagedJobs';

vi.mock('../api', () => ({ apiGet: vi.fn() }));
import { apiGet } from '../api';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Job = { id: string; title?: string };
type Hook = ReturnType<typeof usePagedJobs<Job>>;

let container: HTMLDivElement;
let root: Root;
let hook: Hook;

function Harness({ fetchPage }: { fetchPage?: (path: string) => Promise<JobPage<Job>> }) {
  hook = usePagedJobs<Job>(fetchPage);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const jobs = (...ids: string[]) => ids.map((id) => ({ id }));

function mount(fetchPage?: (path: string) => Promise<JobPage<Job>>) {
  act(() => root.render(<Harness fetchPage={fetchPage} />));
}

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('usePagedJobs', () => {
  it('loads the first page, then appends the next with the cursor and the same filters', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a', 'b'), nextCursor: 'c1', total: 3 })
      .mockResolvedValueOnce({ jobs: jobs('c'), nextCursor: null, total: 3 });
    mount(fetchPage);
    expect(hook.loading).toBe(true);

    let result: string | null = 'unset';
    await act(async () => {
      result = await hook.search('q=bass&kind=gig');
    });
    expect(result).toBeNull();
    expect(fetchPage).toHaveBeenLastCalledWith('/jobs?q=bass&kind=gig');
    expect(hook.jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(hook.total).toBe(3);
    expect(hook.hasMore).toBe(true);
    expect(hook.loading).toBe(false);

    let first: number | null = null;
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(fetchPage).toHaveBeenLastCalledWith('/jobs?q=bass&kind=gig&cursor=c1');
    expect(first).toBe(2);
    expect(hook.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(hook.hasMore).toBe(false);
    expect(hook.loadingMore).toBe(false);

    // Nothing more to load.
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('uses /jobs without a query string and falls back to the list length for the total', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a') })
      .mockResolvedValueOnce({});
    mount(fetchPage);
    await act(async () => {
      await hook.search('');
    });
    expect(fetchPage).toHaveBeenCalledWith('/jobs');
    expect(hook.total).toBe(1);
    expect(hook.hasMore).toBe(false);

    await act(async () => {
      await hook.search('q=x');
    });
    expect(hook.jobs).toEqual([]);
    expect(hook.total).toBe(0);
  });

  it('lets only the newest search change the list', async () => {
    const slow = deferred<JobPage<Job>>();
    const fetchPage = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ jobs: jobs('new'), nextCursor: null, total: 1 });
    mount(fetchPage);
    let stale: Promise<string | null>;
    await act(async () => {
      stale = hook.search('q=old');
      await hook.search('q=new');
    });
    await act(async () => {
      slow.resolve({ jobs: jobs('old'), nextCursor: 'x', total: 99 });
      expect(await stale).toBeNull();
    });
    expect(hook.jobs.map((j) => j.id)).toEqual(['new']);
    expect(hook.total).toBe(1);
    expect(hook.loading).toBe(false);
  });

  it('ignores a stale search failure', async () => {
    const slow = deferred<JobPage<Job>>();
    const fetchPage = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ jobs: jobs('ok'), total: 1 });
    mount(fetchPage);
    let stale: Promise<string | null>;
    await act(async () => {
      stale = hook.search('q=old');
      await hook.search('q=new');
    });
    await act(async () => {
      slow.reject(new Error('late failure'));
      expect(await stale).toBeNull();
    });
    expect(hook.error).toBe('');
    expect(hook.jobs.map((j) => j.id)).toEqual(['ok']);
  });

  it('drops a "load more" page that arrives after a new search started', async () => {
    const more = deferred<JobPage<Job>>();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a'), nextCursor: 'c1', total: 2 })
      .mockReturnValueOnce(more.promise)
      .mockResolvedValueOnce({ jobs: jobs('z'), nextCursor: null, total: 1 });
    mount(fetchPage);
    await act(async () => {
      await hook.search('q=a');
    });
    let pending: Promise<number | null>;
    await act(async () => {
      pending = hook.loadMore();
      await hook.search('q=z');
    });
    await act(async () => {
      more.resolve({ jobs: jobs('b'), nextCursor: null, total: 2 });
      expect(await pending).toBeNull();
    });
    expect(hook.jobs.map((j) => j.id)).toEqual(['z']);
  });

  it('does not start a second "load more" while one is in flight', async () => {
    const more = deferred<JobPage<Job>>();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a'), nextCursor: 'c1', total: 2 })
      .mockReturnValueOnce(more.promise);
    mount(fetchPage);
    await act(async () => {
      await hook.search('');
    });
    let first: Promise<number | null>;
    await act(async () => {
      first = hook.loadMore();
    });
    expect(hook.loadingMore).toBe(true);
    let second: number | null = 0;
    await act(async () => {
      second = await hook.loadMore();
    });
    expect(second).toBeNull();
    await act(async () => {
      more.resolve({ jobs: jobs('b'), nextCursor: null, total: 2 });
      expect(await first).toBe(1);
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('skips jobs already listed and reports nothing new when a page only repeats', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a', 'b'), nextCursor: 'c1', total: 4 })
      .mockResolvedValueOnce({ jobs: jobs('b', 'c'), nextCursor: 'c2' })
      .mockResolvedValueOnce({ jobs: jobs('c'), nextCursor: null });
    mount(fetchPage);
    await act(async () => {
      await hook.search('');
    });
    let first: number | null = null;
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBe(2);
    expect(hook.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c']);
    expect(hook.total).toBe(4);
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBeNull();
    expect(hook.jobs.map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps edits the page makes to listed jobs when more are appended', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ jobs: jobs('a'), nextCursor: 'c1', total: 2 })
      .mockResolvedValueOnce({ jobs: jobs('b'), nextCursor: null });
    mount(fetchPage);
    await act(async () => {
      await hook.search('');
    });
    act(() => hook.setJobs((xs) => xs.map((x) => ({ ...x, title: 'Saved' }))));
    await act(async () => {
      await hook.loadMore();
    });
    expect(hook.jobs).toEqual([{ id: 'a', title: 'Saved' }, { id: 'b' }]);
  });

  it('reports errors for the first page and for "load more" separately', async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server is busy'))
      .mockRejectedValueOnce('not an Error')
      .mockResolvedValueOnce({ jobs: jobs('a'), nextCursor: 'c1', total: 2 })
      .mockRejectedValueOnce(new Error('Network dropped'))
      .mockRejectedValueOnce({})
      .mockResolvedValueOnce({ jobs: jobs('b'), nextCursor: null });
    mount(fetchPage);
    let message: string | null = null;
    await act(async () => {
      message = await hook.search('');
    });
    expect(message).toBe('Server is busy');
    expect(hook.error).toBe('Server is busy');
    await act(async () => {
      message = await hook.search('');
    });
    expect(message).toBe('Unable to load opportunities');

    await act(async () => {
      await hook.search('');
    });
    expect(hook.error).toBe('');
    let first: number | null = 0;
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBeNull();
    expect(hook.moreError).toBe('Network dropped');
    expect(hook.jobs.map((j) => j.id)).toEqual(['a']);
    expect(hook.hasMore).toBe(true);
    await act(async () => {
      await hook.loadMore();
    });
    expect(hook.moreError).toBe('Unable to load more opportunities');
    await act(async () => {
      first = await hook.loadMore();
    });
    expect(first).toBe(1);
    expect(hook.moreError).toBe('');
    expect(hook.jobs.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('fetches through the API client by default', async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ jobs: jobs('api'), nextCursor: null, total: 1 });
    mount();
    await act(async () => {
      await hook.search('paid=true');
    });
    expect(apiGet).toHaveBeenCalledWith('/jobs?paid=true');
    expect(hook.jobs.map((j) => j.id)).toEqual(['api']);
  });
});
