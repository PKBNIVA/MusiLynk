import { FormEvent, useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Search, Bookmark, BookmarkCheck, Bell, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router';
import { apiDelete, apiPost } from '../lib/api';
import { LoadMoreJobs } from '../components/LoadMoreJobs';
import { JobCard, titleCase } from '../components/JobCard';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../components/SearchFeedback';
import { usePagedJobs } from '../lib/usePagedJobs';
import { useLatestCallback } from '../lib/useLatestCallback';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useFunctionAreas } from '../lib/useTaxonomy';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import type { Job } from '../lib/apiTypes';

const kinds = ['', 'job', 'gig', 'audition', 'session', 'tour', 'internship', 'collaboration'];
const workplaces = ['', 'onsite', 'hybrid', 'remote', 'travel'];
// URL keys are the API's filter names, so the URL is the search.
const FILTERS = ['q', 'location', 'kind', 'function', 'workplace', 'paid', 'verified'] as const;

export default function JobSearch() {
  const list = usePagedJobs<Job>();
  const { jobs, setJobs, loading, total, meta } = list;
  const functions = useFunctionAreas();
  // Filters and the query live in the URL: reload, share and bookmark a search; Back undoes the
  // last change (SRCH-08). Selects apply at once; typed text waits for Search/Enter.
  const { values: f, query, update, clear } = useUrlFilters(FILTERS);
  const [showFilters, setShowFilters] = useState(() =>
    Boolean(f.kind || f.function || f.workplace || f.paid || f.verified),
  );
  const [q, setQ] = useState(f.q),
    [location, setLocation] = useState(f.location);
  useEffect(() => {
    setQ(f.q);
    setLocation(f.location);
  }, [f.q, f.location]);
  // Only the newest search may update the list (usePagedJobs), so a slow earlier response cannot overwrite it.
  const run = useLatestCallback(async () => {
    const error = await list.search(query);
    if (error) toast.error(error);
  });
  useEffect(() => {
    void run();
  }, [query, run]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!update({ q, location })) void run();
  };
  async function toggleSave(j: Job) {
    try {
      j.saved ? await apiDelete(`/saved-jobs/${j.id}`) : await apiPost(`/saved-jobs/${j.id}`);
      setJobs((xs) => xs.map((x) => (x.id === j.id ? { ...x, saved: !x.saved } : x)));
      toast.success(j.saved ? 'Removed from saved' : 'Saved for later');
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function createAlert() {
    try {
      await apiPost('/job-alerts', {
        name: f.q || f.kind || 'Music opportunities',
        query: f.q,
        location: f.location,
        opportunityKind: f.kind,
        functionArea: f.function,
        remoteOnly: f.workplace === 'remote',
        frequency: 'saved',
      });
      toast.success('Search saved to your account');
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-7">
          <div>
            <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Opportunities</div>
            <h1 className="text-4xl md:text-5xl font-bold">Find work across the music industry</h1>
            <p className="text-slate-400 mt-3 max-w-3xl">
              Jobs are only one format. Discover gigs, auditions, sessions, tours, internships and collaborations with
              clearer work terms and trust signals.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link to="/jobseeker/alerts">Manage alerts</Link>
            </Button>
            <Button variant="outline" onClick={createAlert}>
              <Bell className="w-4 h-4 mr-2" />
              Save this search
            </Button>
          </div>
        </div>
        <Card className="bg-white/[.055] border-white/10 mb-7">
          <CardContent className="p-4 md:p-5">
            <form onSubmit={submit} className="grid lg:grid-cols-[1.4fr_1fr_auto_auto] gap-3" role="search">
              <label htmlFor="job-search-query" className="sr-only">
                Search opportunities
              </label>
              <Input
                id="job-search-query"
                aria-label="Search opportunities"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Role, skill, company, instrument…"
                className="bg-black/20 border-white/15"
              />
              <label htmlFor="job-search-location" className="sr-only">
                Location
              </label>
              <Input
                id="job-search-location"
                aria-label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, state or remote"
                className="bg-black/20 border-white/15"
              />
              <Button
                type="button"
                variant="outline"
                aria-expanded={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button>
                <Search className="w-4 h-4 mr-2" />
                Search
              </Button>
            </form>
            {showFilters && (
              <div className="grid md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10">
                <select
                  aria-label="Opportunity type"
                  value={f.kind}
                  onChange={(e) => update({ kind: e.target.value })}
                  className="h-10 rounded-md bg-slate-900 border border-white/15 px-3"
                >
                  {kinds.map((x) => (
                    <option key={x} value={x}>
                      {x ? titleCase(x) : 'All opportunity types'}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Function"
                  value={f.function}
                  onChange={(e) => update({ function: e.target.value })}
                  className="h-10 rounded-md bg-slate-900 border border-white/15 px-3"
                >
                  <option value="">All functions</option>
                  {functions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                  {f.function && !functions.includes(f.function) && <option value={f.function}>{f.function}</option>}
                </select>
                <select
                  aria-label="Workplace"
                  value={f.workplace}
                  onChange={(e) => update({ workplace: e.target.value })}
                  className="h-10 rounded-md bg-slate-900 border border-white/15 px-3"
                >
                  {workplaces.map((x) => (
                    <option key={x} value={x}>
                      {x ? titleCase(x) : 'Any workplace'}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Checkbox checked={f.paid === 'true'} onCheckedChange={(v) => update({ paid: v ? 'true' : '' })} />
                  Paid only
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <Checkbox
                    checked={f.verified === 'true'}
                    onCheckedChange={(v) => update({ verified: v ? 'true' : '' })}
                  />
                  Verified employers only
                </label>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-slate-400">
            {loading ? 'Searching…' : `${total} ${total === 1 ? 'opportunity' : 'opportunities'} found`}
          </div>
          <Link to="/jobseeker/saved" className="text-sm text-violet-300 hover:text-violet-200">
            View saved opportunities
          </Link>
        </div>
        {!loading && <SearchNotice meta={meta} query={f.q} />}
        {loading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((x) => (
              <div key={x} className="h-44 rounded-2xl bg-white/[.04] animate-pulse" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-2">
              <NoResults
                noun="opportunities"
                query={f.q}
                meta={meta}
                onSearch={(term) => update({ q: term })}
                suggestions={POPULAR_SEARCHES}
                onClear={query ? clear : undefined}
              >
                <Button variant="outline" onClick={createAlert}>
                  <Bell className="w-4 h-4 mr-2" />
                  Save as an alert
                </Button>
              </NoResults>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 mt-4">
            {jobs.map((j, index) => (
              <JobCard
                key={j.id}
                job={j}
                index={index}
                to={`/jobseeker/jobs/${j.id}`}
                aside={
                  <Button
                    aria-label={j.saved ? 'Remove from saved' : 'Save job'}
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleSave(j)}
                  >
                    {j.saved ? <BookmarkCheck className="text-violet-300" /> : <Bookmark />}
                  </Button>
                }
              />
            ))}
          </div>
        )}
        {!loading && (
          <LoadMoreJobs
            shown={jobs.length}
            total={total}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            error={list.moreError}
            onLoadMore={list.loadMore}
          />
        )}
      </main>
    </div>
  );
}
