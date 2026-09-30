import { DemoBadge } from '../../components/DemoBadge';
import { usePageMeta } from '../../components/PageMeta';
import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search, ShieldCheck, X, Zap } from 'lucide-react';
import { personLines } from '../../lib/personLine';
import { UserAvatar } from '../../components/kit/UserAvatar';
import { FirstSample } from '../../components/talent/FirstSample';
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
import { TALENT_ROLES, talentRoleLabel, useTaxonomy } from '../../lib/useTaxonomy';
import type { Professional } from '../../lib/apiTypes';

type TalentPage = PageMeta & { talent?: Professional[]; role?: { key: string; label: string } };
const pickTalent = (page: TalentPage) => page.talent;
const FILTERS = ['q', 'location', 'role', 'verified'] as const;
const NOUN = ['professional', 'professionals'] as const;

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full border px-3.5 text-sm ${
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
  usePageMeta(
    'Find musicians & music professionals',
    'Search singers, instrumentalists, composers, engineers, technical directors, tour crew and managers on Verse.',
    { canonicalPath: '/music-professionals', type: 'website' },
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
                {list.total} {list.total === 1 ? 'professional' : 'professionals'}
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
                <Card
                  key={c.id}
                  data-list-item={index}
                  tabIndex={-1}
                  className="relative h-full bg-white/[.05] border-white/10 hover:bg-white/[.075] focus-within:ring-2 focus-within:ring-violet-400"
                >
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <UserAvatar id={c.id} name={c.name} size="lg" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="truncate text-lg font-semibold">
                            <Link
                              to={`/professionals/${c.id}`}
                              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                            >
                              {c.name}
                            </Link>
                          </h2>
                          <DemoBadge show={c.demo} />
                          {c.verified && (
                            <ShieldCheck size={16} aria-label="Verified" className="shrink-0 text-emerald-300" />
                          )}
                          {c.fastResponderBadge && (
                            <Zap size={16} className="text-amber-300" aria-label="Fast responder this week" />
                          )}
                        </div>
                        {(() => {
                          const line = personLines(c);
                          return (
                            <>
                              <p className="mt-0.5 text-sm text-slate-300">{line.primary || 'Music professional'}</p>
                              {line.secondary.length > 0 && (
                                <p className="mt-0.5 text-sm text-slate-400">
                                  {line.secondary.slice(0, 3).join(' · ')}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="relative z-10 mt-4">
                      <FirstSample id={c.id} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[...(c.roles || []), ...(c.instruments || [])].slice(0, 3).map((x: string) => (
                        <Badge variant="secondary" key={x}>
                          {x}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
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
