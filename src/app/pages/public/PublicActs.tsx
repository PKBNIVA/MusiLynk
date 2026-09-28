import { DemoBadge } from '../../components/DemoBadge';
import { usePageMeta } from '../../components/PageMeta';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ActSearchForm } from '../../components/ActSearchForm';
import { LoadMore } from '../../components/LoadMore';
import { NoResults, SearchNotice } from '../../components/SearchFeedback';
import { MapPin, ShieldCheck } from 'lucide-react';
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
                <Link
                  key={a.id}
                  to={`/acts/${a.id}`}
                  data-list-item={index}
                  className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <Card className="h-full bg-white/[.05] border-white/10 hover:bg-white/[.075]">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold">{a.name}</h2>
                        <DemoBadge show={a.demo} />
                        {a.verified && <ShieldCheck size={16} className="text-emerald-300" />}
                      </div>
                      <p className="text-violet-300 mt-1">{a.act_type}</p>
                      {a.city && (
                        <p className="text-sm text-slate-400 mt-3 flex">
                          <MapPin size={15} className="mr-1" />
                          {a.city}
                        </p>
                      )}
                      <p className="text-sm text-slate-300 mt-3 line-clamp-3">{a.tagline || a.bio}</p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        {a.genres?.slice(0, 4).map((x: string) => (
                          <Badge key={x} variant="secondary">
                            {x}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
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
