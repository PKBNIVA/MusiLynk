import { usePagedList, type PageMeta } from './usePagedList';

/** One page of GET /jobs: the jobs, an opaque cursor for the next page (null on the last) and the match count. */
export type JobPage<T> = PageMeta & { jobs?: T[] };

type Fetcher<T> = (path: string) => Promise<JobPage<T>>;

const pickJobs = <T>(page: JobPage<T>) => page.jobs;

/**
 * The paged opportunity list behind job search and the public jobs page (see usePagedList).
 * `search(query)` starts over with new filters; `loadMore()` appends the next page.
 */
export function usePagedJobs<T extends { id: string | number }>(fetchPage?: Fetcher<T>) {
  const { items, setItems, ...list } = usePagedList<T, JobPage<T>>({
    path: '/jobs',
    pick: pickJobs,
    noun: 'opportunities',
    fetchPage,
  });
  return { jobs: items, setJobs: setItems, ...list };
}
