import { DemoBadge } from '../../components/DemoBadge';
import { usePageMeta } from '../../components/PageMeta';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MapPin, Search, ShieldCheck, X } from 'lucide-react';
import { PublicNav } from '../../components/PublicNav';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { LoadMore } from '../../components/LoadMore';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../../components/SearchFeedback';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { usePagedList, type PageMeta } from '../../lib/usePagedList';
import { useUrlFilters } from '../../lib/useUrlFilters';
import { talentRoleLabel, useTaxonomy } from '../../lib/useTaxonomy';
import type { Professional } from '../../lib/apiTypes';

type TalentPage = PageMeta & { talent?: Professional[]; role?: { key: string; label: string } };
const pickTalent = (page: TalentPage) => page.talent;
const FILTERS = ['q', 'location', 'role'] as const;
const NOUN = ['professional', 'professionals'] as const;

export default function PublicTalent() {
  usePageMeta(
    'Find musicians & music professionals',
    'Search singers, instrumentalists, composers, engineers, technical directors, tour crew and managers on Verse.',
  );
  // Filters live in the URL; each change is a history entry, so Back undoes it.
  const { values, query, update, clear } = useUrlFilters(FILTERS);
  const taxonomy = useTaxonomy();
  const list = usePagedList<Professional, TalentPage>({
    path: '/public/talent',
    pick: pickTalent,
    noun: 'professionals',
  });
  const { items, loading, error, meta } = list;
  const [q, setQ] = useState(values.q),
    [location, setLocation] = useState(values.location);
  useEffect(() => {
    setQ(values.q);
    setLocation(values.location);
  }, [values.q, values.location]);
  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    void load();
  }, [query, load]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!update({ q, location })) void load();
  };
  // The API labels free-text roles ("drummer" → "Drummer"); the taxonomy covers the fixed directory keys.
  const roleLabel = values.role ? list.first?.role?.label || talentRoleLabel(values.role, taxonomy) : '';
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-5 py-14">
        <p className="text-xs uppercase tracking-[.22em] text-violet-300">Music professional directory</p>
        <h1 className="text-4xl md:text-6xl font-bold mt-2">Find musicians, creators & production professionals</h1>
        <p className="text-slate-400 mt-4">
          Search singers, instrumentalists, composers, engineers, technical directors, tour crew, managers and more.
        </p>
        {roleLabel && (
          <Badge className="mt-4 gap-1 pr-1" variant="secondary" data-testid="role-filter">
            Showing: {roleLabel}
            <button
              type="button"
              className="ml-1 rounded-full p-0.5 hover:bg-white/10"
              aria-label={`Remove filter ${roleLabel}`}
              onClick={() => update({ role: '' })}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </Badge>
        )}
        <form onSubmit={submit} className="grid md:grid-cols-[1.3fr_1fr_auto] gap-3 mt-8" role="search">
          <label htmlFor="public-talent-query" className="sr-only">
            Search professionals
          </label>
          <Input
            id="public-talent-query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tabla, playback singer, DiGiCo, composer…"
            className="bg-white/5 border-white/15"
          />
          <label htmlFor="public-talent-location" className="sr-only">
            Professional location
          </label>
          <Input
            id="public-talent-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or region"
            className="bg-white/5 border-white/15"
          />
          <Button disabled={loading}>
            <Search size={16} className="mr-2" />
            Search
          </Button>
        </form>
        {!loading && !error && items.length > 0 && (
          <p className="text-sm text-slate-400 mt-5" data-testid="result-count">
            {list.total} {list.total === 1 ? 'professional' : 'professionals'}
          </p>
        )}
        {!loading && <SearchNotice meta={meta} query={values.q} />}
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading professionals…
          </p>
        ) : error ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">{error}</p>
            <Button variant="outline" className="mt-4" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : items.length ? (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {items.map((c, index) => (
                <Link
                  to={`/professionals/${c.id}`}
                  key={c.id}
                  data-list-item={index}
                  className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <Card className="h-full bg-white/[.05] border-white/10 hover:bg-white/[.075]">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold">{c.name}</h2>
                        <DemoBadge show={c.demo} />
                        {c.verified && <ShieldCheck size={16} className="text-emerald-300" />}
                      </div>
                      <p className="text-violet-300 mt-1">{c.headline || 'Music professional'}</p>
                      {c.location && (
                        <p className="flex text-sm text-slate-400 mt-3">
                          <MapPin size={15} className="mr-1" />
                          {c.location}
                        </p>
                      )}
                      <p className="text-sm text-slate-300 mt-3 line-clamp-3">
                        {c.bio || 'Professional profile on Verse.'}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        {[...(c.roles || []), ...(c.instruments || [])].slice(0, 5).map((x: string) => (
                          <Badge variant="secondary" key={x}>
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
              shown={items.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              error={list.moreError}
              onLoadMore={list.loadMore}
              noun={NOUN}
            />
          </>
        ) : (
          <NoResults
            noun="professionals"
            query={values.q}
            meta={meta}
            onSearch={(term) => update({ q: term })}
            suggestions={POPULAR_SEARCHES}
            onClear={query ? clear : undefined}
          >
            <Button variant="outline" asChild>
              <Link to="/join/musician">List your profile</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/join/hiring">Start hiring</Link>
            </Button>
          </NoResults>
        )}
      </main>
    </div>
  );
}
