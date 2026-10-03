import { usePageMeta } from '../../components/PageMeta';
import { PUBLIC_PAGE_META } from '../../lib/siteMeta';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { PublicNav } from '../../components/PublicNav';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { LoadMoreJobs } from '../../components/LoadMoreJobs';
import { JobCard } from '../../components/JobCard';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../../components/SearchFeedback';
import { usePagedJobs } from '../../lib/usePagedJobs';
import { useUrlFilters } from '../../lib/useUrlFilters';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { useAuth } from '../../lib/authContext';
import type { Job } from '../../lib/apiTypes';

/** Apply/sign-in-to-apply CTA beside a public job card. Held back while the stored session is
 * still hydrating so it never flashes "Sign in to apply" for a visitor who turns out to be
 * signed in (V-13). */
function ApplyCta({ job }: { job: Job }) {
  const { status } = useAuth();
  if (status === 'loading') return null;
  if (status === 'signedIn')
    return (
      <Button size="sm" asChild>
        <Link to={`/jobseeker/jobs/${encodeURIComponent(String(job.id))}`}>Apply</Link>
      </Button>
    );
  return (
    <Button size="sm" variant="outline" asChild>
      <Link to="/auth/jobseeker" state={{ from: `/jobseeker/jobs/${encodeURIComponent(String(job.id))}` }}>
        Sign in to apply
      </Link>
    </Button>
  );
}

const kinds = ['job', 'gig', 'audition', 'session', 'tour'] as const;
const FILTERS = ['q', 'location', 'kind'] as const;
// Older links used plural kinds (?kind=gigs).
const singularKind = (kind: string) => (kind.endsWith('s') ? kind.slice(0, -1) : kind);

export default function PublicJobs() {
  usePageMeta(PUBLIC_PAGE_META['/music-jobs'].title, PUBLIC_PAGE_META['/music-jobs'].description, {
    canonicalPath: '/music-jobs',
    type: 'website',
  });
  // Filters live in the URL and every change is a history entry, so Back undoes one (SRCH-09).
  const { values, query, update, clear, ready } = useUrlFilters(FILTERS);
  const list = usePagedJobs<Job>();
  const { jobs, loading, error, total, meta } = list;
  const kind = singularKind(values.kind);
  // The text boxes follow the URL (so Back restores them) but only search on submit.
  const [q, setQ] = useState(values.q),
    [location, setLocation] = useState(values.location);
  useEffect(() => {
    setQ(values.q);
    setLocation(values.location);
  }, [values.q, values.location]);
  const run = useLatestCallback(() => {
    const params = new URLSearchParams(query);
    if (kind) params.set('kind', kind);
    return list.search(params.toString());
  });
  useEffect(() => {
    if (ready) void run();
  }, [query, run, ready]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Searching again for the same thing refreshes the results.
    if (!update({ q, location })) void run();
  };
  const searchFor = (term: string) => update({ q: term });
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-5 py-14">
        <p className="text-xs uppercase tracking-[.22em] text-violet-300">Open music opportunities</p>
        <h1 className="text-4xl md:text-6xl font-bold mt-2">Music jobs, gigs, sessions, auditions & tours</h1>
        <p className="text-slate-400 mt-4 max-w-3xl">
          Discover public opportunities across performance, production, engineering, live shows, management, rights,
          labels and more.
        </p>
        <div className="flex flex-wrap gap-2 mt-6" role="group" aria-label="Opportunity type">
          <Button
            size="sm"
            aria-pressed={!kind}
            variant={!kind ? 'secondary' : 'outline'}
            onClick={() => update({ kind: '' })}
          >
            All
          </Button>
          {kinds.map((x) => (
            <Button
              key={x}
              size="sm"
              aria-pressed={kind === x}
              variant={kind === x ? 'secondary' : 'outline'}
              onClick={() => update({ kind: x })}
              className="capitalize"
            >
              {x}s
            </Button>
          ))}
        </div>
        <form onSubmit={submit} className="grid md:grid-cols-[1.3fr_1fr_auto] gap-3 mt-5" role="search">
          <label htmlFor="public-job-query" className="sr-only">
            Search opportunities
          </label>
          <Input
            id="public-job-query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Bassist, FOH engineer, composer, vocalist…"
            className="bg-white/5 border-white/15"
          />
          <label htmlFor="public-job-location" className="sr-only">
            Opportunity location
          </label>
          <Input
            id="public-job-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Mumbai, Delhi, remote…"
            className="bg-white/5 border-white/15"
          />
          <Button disabled={loading}>
            <Search size={16} className="mr-2" />
            Search
          </Button>
        </form>
        {!loading && !error && jobs.length > 0 && (
          <p className="text-sm text-slate-400 mt-5" data-testid="result-count">
            {total} {total === 1 ? 'opportunity' : 'opportunities'}
          </p>
        )}
        {!loading && <SearchNotice meta={meta} query={values.q} />}
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading opportunities…
          </p>
        ) : error ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => run()}>
              Try again
            </Button>
          </div>
        ) : jobs.length ? (
          <>
            <div className="grid gap-4 mt-6">
              {jobs.map((j, index) => (
                <JobCard key={j.id} job={j} index={index} to={`/opportunities/${j.id}`} aside={<ApplyCta job={j} />} />
              ))}
            </div>
            <LoadMoreJobs
              shown={jobs.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              error={list.moreError}
              onLoadMore={list.loadMore}
            />
          </>
        ) : (
          <NoResults
            noun="opportunities"
            query={values.q}
            meta={meta}
            onSearch={searchFor}
            suggestions={POPULAR_SEARCHES}
            onClear={query ? clear : undefined}
          >
            <Button variant="outline" asChild>
              <Link to="/join/musician">Create musician account</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/auth/employer">Post an opportunity</Link>
            </Button>
          </NoResults>
        )}
      </main>
    </div>
  );
}
