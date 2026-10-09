import { usePageMeta } from '../../components/PageMeta';
import { PUBLIC_PAGE_META } from '../../lib/siteMeta';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search, X } from 'lucide-react';
import { TalentCard } from '../../components/talent/TalentCard';
import { FACET_KEYS, TalentFacets } from '../../components/talent/TalentFacets';
import { PublicNav } from '../../components/PublicNav';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { LoadMore } from '../../components/LoadMore';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../../components/SearchFeedback';
import { useLatestCallback } from '../../lib/useLatestCallback';
import { usePagedList, type PageMeta } from '../../lib/usePagedList';
import { useUrlFilters } from '../../lib/useUrlFilters';
import { TALENT_ROLES, talentRoleLabel, useTaxonomy } from '../../lib/useTaxonomy';
import type { Professional } from '../../lib/apiTypes';

type TalentPage = PageMeta & { talent?: Professional[]; role?: { key: string; label: string } };
const pickTalent = (page: TalentPage) => page.talent;
const FILTERS = ['q', 'location', 'role', 'verified', ...FACET_KEYS] as const;
const NOUN = ['musician', 'musicians'] as const;

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-10 shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 text-sm ${
        pressed
          ? 'border-violet-400 bg-violet-500/20 text-white'
          : 'border-white/15 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'
      }`}
    >
      {children}
    </button>
  );
}

export default function PublicTalent() {
  usePageMeta(PUBLIC_PAGE_META['/music-professionals'].title, PUBLIC_PAGE_META['/music-professionals'].description, {
    canonicalPath: '/music-professionals',
    type: 'website',
  });
  // Filters live in the URL; each change is a history entry, so Back undoes it.
  const { values, query, update, clear, ready } = useUrlFilters(FILTERS);
  const taxonomy = useTaxonomy();
  const list = usePagedList<Professional, TalentPage>({
    path: '/public/talent',
    pick: pickTalent,
    noun: 'musicians',
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
    if (ready) void load();
  }, [query, load, ready]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!update({ q, location })) void load();
  };
  // The API labels free-text roles ("drummer" → "Drummer"); the taxonomy covers the fixed directory keys.
  const roleChips = (taxonomy?.talentRoles || TALENT_ROLES).slice(0, 8);
  const roleLabel = values.role ? list.first?.role?.label || talentRoleLabel(values.role, taxonomy) : '';
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-5 py-14">
        <h1 className="text-3xl font-bold">Musicians in {values.location || 'India'}</h1>
        <p className="mt-2 text-slate-400">
          {!loading && !error && items.length > 0 && (
            <>
              <span data-testid="result-count">
                {list.total} {list.total === 1 ? 'musician' : 'musicians'}
              </span>
              {' · '}
            </>
          )}
          verified badges shown where earned
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
            Search musicians
          </label>
          <Input
            id="public-talent-query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tabla, playback singer, DiGiCo, composer…"
            className="bg-white/5 border-white/15"
          />
          <label htmlFor="public-talent-location" className="sr-only">
            Musician location
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
        <div
          className="-mx-5 mt-4 flex snap-x flex-nowrap gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
          role="group"
          aria-label="Filters"
        >
          {roleChips.map((r) => (
            <Chip
              key={r.key}
              pressed={values.role.toLowerCase() === r.key.toLowerCase()}
              onClick={() => update({ role: values.role.toLowerCase() === r.key.toLowerCase() ? '' : r.key })}
            >
              {r.label}
            </Chip>
          ))}
          <Chip
            pressed={values.location.toLowerCase() === 'mumbai'}
            onClick={() => update({ location: values.location.toLowerCase() === 'mumbai' ? '' : 'Mumbai' })}
          >
            Mumbai
          </Chip>
          <Chip
            pressed={values.verified === 'true'}
            onClick={() => update({ verified: values.verified === 'true' ? '' : 'true' })}
          >
            Verified only
          </Chip>
        </div>
        <TalentFacets values={values} update={update} />
        {!loading && <SearchNotice meta={meta} query={values.q} />}
        {loading ? (
          // Placeholder cards at the real card size, so the list does not jump when results arrive.
          <div role="status" aria-label="Loading musicians" className="mt-6">
            <div aria-hidden="true" className="grid min-h-[30rem] gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-xl border border-white/10 bg-white/[.04]" />
              ))}
            </div>
            <span className="sr-only">Loading musicians…</span>
          </div>
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
                <TalentCard key={c.id} person={c} index={index} to={`/professionals/${c.id}`} />
              ))}
            </div>
            <LoadMore
              shown={items.length}
              total={list.total}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              error={list.moreError}
              onLoadMore={list.loadMore}
              onNear={list.prefetchMore}
              noun={NOUN}
            />
          </>
        ) : (
          <NoResults
            noun="musicians"
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
