import { usePageMeta } from '../../components/PageMeta';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { ActCard } from '../../components/talent/ActCard';
import { Button } from '../../components/ui/button';
import { ActSearchForm } from '../../components/ActSearchForm';
import { LoadMore } from '../../components/LoadMore';
import { NoResults, SearchNotice } from '../../components/SearchFeedback';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { usePagedList, type PageMeta } from '../../lib/usePagedList';
import { useUrlFilters } from '../../lib/useUrlFilters';
import type { Act } from '../../lib/apiTypes';

type ActPage = PageMeta & { acts?: Act[] };
const pickActs = (page: ActPage) => page.acts;
const FILTERS = ['q', 'city', 'type'] as const;
const NOUN = ['act', 'acts'] as const;
const ACT_SUGGESTIONS = ['wedding band', 'sufi', 'jazz', 'DJ', 'singer'] as const;

export default function PublicActs() {
  usePageMeta(
    'Book singers, bands & live acts',
    'Discover bookable singers, duos, bands and ensembles, compare lineups and request a quote for your event on Verse.',
    { canonicalPath: '/book-music', type: 'website' },
  );
  const { values, query, update, clear } = useUrlFilters(FILTERS);
  const list = usePagedList<Act, ActPage>({ path: '/public/acts', pick: pickActs, noun: 'acts' });
  const { items: acts, loading, error, meta } = list;
  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    void load();
  }, [query, load]);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-5 py-14">
        <p className="text-xs uppercase tracking-[.22em] text-violet-300">Live music booking</p>
        <h1 className="text-4xl md:text-6xl font-bold mt-2">Book singers, bands, ensembles & live acts</h1>
        <p className="text-slate-400 mt-4">
          Discover public acts, inspect lineup and repertoire, then sign in to request availability and a quote.
        </p>
        <ActSearchForm
          idPrefix="public-acts"
          values={values}
          busy={loading}
          onSearch={(changes) => {
            if (!update(changes)) void load();
          }}
          onType={(type) => update({ type })}
        />
        {!loading && !error && acts.length > 0 && (
          <p className="text-sm text-slate-400 mt-5" data-testid="result-count">
            {list.total} {list.total === 1 ? 'act' : 'acts'}
          </p>
        )}
        {!loading && <SearchNotice meta={meta} query={values.q} />}
        {loading ? (
          <p className="py-16 text-center text-slate-400" role="status">
            Loading acts…
          </p>
        ) : error ? (
          <div className="py-16 text-center" role="alert">
            <p className="text-rose-300">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : acts.length === 0 ? (
          query ? (
            <NoResults
              noun="acts"
              query={values.q}
              meta={meta}
              onSearch={(term) => update({ q: term })}
              suggestions={ACT_SUGGESTIONS}
              onClear={clear}
            />
          ) : (
            <div className="py-16 text-center">
              <p className="text-slate-500">No bookable acts are listed yet.</p>
              <div className="flex flex-wrap justify-center gap-3 mt-5">
                <Button asChild>
                  <Link to="/auth/jobseeker">List your act</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/guide">How booking works</Link>
                </Button>
              </div>
            </div>
          )
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {acts.map((a, index) => (
                <ActCard key={a.id} act={a} index={index} to={`/acts/${a.id}`} />
              ))}
            </div>
            <LoadMore
              shown={acts.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              error={list.moreError}
              onLoadMore={list.loadMore}
              noun={NOUN}
            />
          </>
        )}
      </main>
    </div>
  );
}
