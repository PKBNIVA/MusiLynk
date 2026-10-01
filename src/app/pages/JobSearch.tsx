import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Search, Bookmark, BookmarkCheck, Bell, SlidersHorizontal, X } from 'lucide-react';
import { Link } from 'react-router';
import { apiDelete, apiPost } from '../lib/api';
import { LoadMoreJobs } from '../components/LoadMoreJobs';
import { JobCard } from '../components/JobCard';
import { JobFilterChips } from '../components/JobFilterChips';
import { optionLabel } from '../components/ui/option-labels';
import { useAuth } from '../lib/authContext';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../components/SearchFeedback';
import { usePagedJobs } from '../lib/usePagedJobs';
import { useLatestCallback } from '../lib/useLatestCallback';
import { useUrlFilters } from '../lib/useUrlFilters';
import { useFunctionAreas } from '../lib/useTaxonomy';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import type { Job } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';

const kinds = ['', 'job', 'gig', 'audition', 'session', 'tour', 'internship', 'collaboration'];
const workplaces = ['', 'onsite', 'hybrid', 'remote', 'travel'];
// URL keys are the API's filter names, so the URL is the search.
const FILTERS = ['q', 'location', 'kind', 'function', 'workplace', 'paid', 'verified'] as const;

export default function JobSearch() {
  const { user } = useAuth();
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
  // First visit with no search in the URL: start from the musician's own roles and city. They show
  // as chips below and are removed like any other filter; this runs once per visit, so removing
  // them (or pressing Back) is never undone.
  const profileRoles = (user?.roles ?? []).filter(Boolean).slice(0, 6);
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (defaultsApplied.current || !user) return;
    defaultsApplied.current = true;
    if (query) return;
    update({ location: user.location || '', q: profileRoles[0] || '' }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
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
        <PageHeader
          help={<HelpCallout {...HELP.jobs} />}
          title="Find work"
          hint="Gigs, sessions, auditions and tours"
          actions={
            <>
              <Button variant="ghost" asChild>
                <Link to="/jobseeker/alerts">Manage alerts</Link>
              </Button>
              <Button variant="outline" onClick={createAlert}>
                <Bell className="w-4 h-4 mr-2" />
                Save this search
              </Button>
            </>
          }
        />
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
                <AppSelect
                  aria-label="Opportunity type"
                  value={f.kind}
                  onValueChange={(v) => update({ kind: v })}
                  options={kinds.map((x) => (x ? x : { value: '', label: 'All opportunity types' }))}
                />
                <AppSelect
                  aria-label="Function"
                  value={f.function}
                  onValueChange={(v) => update({ function: v })}
                  options={[
                    { value: '', label: 'All functions' },
                    ...functions,
                    ...(f.function && !functions.includes(f.function) ? [f.function] : []),
                  ]}
                />
                <AppSelect
                  aria-label="Workplace"
                  value={f.workplace}
                  onValueChange={(v) => update({ workplace: v })}
                  options={workplaces.map((x) => (x ? x : { value: '', label: 'Any workplace' }))}
                />
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
        {profileRoles.length > 0 && (
          <div role="group" aria-label="Your roles" className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Your roles</span>
            {profileRoles.map((role) => {
              const on = f.q.toLowerCase() === role.toLowerCase();
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ q: on ? '' : role })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                    on
                      ? 'border-violet-400/50 bg-violet-500/15 text-violet-100'
                      : 'border-white/10 bg-white/[.04] text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {role}
                  {on && <X aria-hidden="true" size={14} />}
                  {on && <span className="sr-only">(remove)</span>}
                </button>
              );
            })}
          </div>
        )}
        <JobFilterChips values={f} profileCity={user?.location} onChange={(c) => update(c)} />
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm text-slate-400" role="status">
            {loading
              ? 'Searching…'
              : `${total} ${total === 1 ? 'opportunity' : 'opportunities'} · ${f.location || 'all cities'} · ${
                  f.kind ? optionLabel(f.kind).toLowerCase() : 'all formats'
                }`}
          </div>
          <Link to="/jobseeker/saved" className="text-sm text-violet-300 hover:text-violet-200">
            View saved opportunities
          </Link>
        </div>
        {!loading && <SearchNotice meta={meta} query={f.q} />}
        {loading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((x) => (
              <div key={x} className="h-24 rounded-2xl bg-white/[.04] animate-pulse" />
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
                    className="tap-target-44"
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
