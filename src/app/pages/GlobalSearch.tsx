import { usePageMeta } from '../components/PageMeta';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Briefcase, Music, PlayCircle, Search, Sparkles, Users } from 'lucide-react';
import { PublicNav } from '../components/PublicNav';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { DemoBadge } from '../components/DemoBadge';
import { LoadMore } from '../components/LoadMore';
import { NoResults, SearchNotice } from '../components/SearchFeedback';
import { useLatestCallback } from '../lib/useLatestCallback';
import { usePagedList } from '../lib/usePagedList';
import type { SearchResponse, SearchResult } from '../lib/apiTypes';
import type { LucideIcon } from 'lucide-react';

type ResultType = SearchResult['type'];
const icons: Record<string, LucideIcon> = { jobs: Briefcase, talent: Users, acts: Music, samples: PlayCircle };
const TYPE_LABELS: Record<ResultType, [string, string]> = {
  jobs: ['Opportunities', 'opportunities'],
  talent: ['Professionals', 'professionals'],
  acts: ['Acts', 'acts'],
  samples: ['Work samples', 'work samples'],
};
const TYPES = Object.keys(TYPE_LABELS) as ResultType[];
const suggestions = ['Playback singer', 'FOH engineer', 'Session guitarist', 'Wedding band', 'Music producer'];
const pickResults = (page: SearchResponse) => page.results;
const isType = (value: string): value is ResultType => (TYPES as string[]).includes(value);

export default function GlobalSearch() {
  const [sp, setSp] = useSearchParams();
  const query = sp.get('q') || '';
  const rawType = sp.get('type') || 'all';
  const selectedType = isType(rawType) ? rawType : 'all';
  usePageMeta(
    query.trim() ? `Search: ${query.trim().slice(0, 60)}` : 'Search Verse',
    'Search music jobs, professionals, bookable acts and work samples across the Verse network.',
  );
  const [q, setQ] = useState(query);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('verse_recent_searches') || '[]');
    } catch {
      return [];
    }
  });
  // "Everything" is one page of each type; a single type is paged like the lists.
  const list = usePagedList<SearchResult & { id: string }, SearchResponse>({
    path: '/search',
    pick: pickResults,
    noun: 'results',
  });
  const { items: results, loading, error, meta, first } = list;

  const run = useLatestCallback(async () => {
    const text = query.trim();
    if (!text) return;
    const params = new URLSearchParams({ q: text });
    if (selectedType !== 'all') params.set('type', selectedType);
    const failed = await list.search(params.toString());
    if (failed) return;
    setRecent((previous) => {
      const next = [text, ...previous.filter((x) => x !== text)].slice(0, 6);
      try {
        localStorage.setItem('verse_recent_searches', JSON.stringify(next));
      } catch {
        /* storage blocked: keep in memory */
      }
      return next;
    });
  });
  useEffect(() => {
    setQ(query);
    void run();
  }, [query, selectedType, run]);

  // Every search and type change is a history entry, so Back returns to the previous one.
  const searchFor = (value: string, type: string = selectedType) =>
    setSp({ q: value, ...(type !== 'all' ? { type } : {}) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (q.trim()) searchFor(q.trim());
  };
  const searched = Boolean(query.trim());
  const interpreted = meta.interpretedAs || [];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-6xl px-5 py-12">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-bold text-fuchsia-200">
            <Sparkles size={14} />
            One search. The whole music network.
          </div>
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">
            Find the people and work that <span className="verse-gradient-text">move music forward.</span>
          </h1>
          <p className="mt-3 text-lg text-slate-300">
            Explore opportunities, professionals, bookable acts and real work samples.
          </p>
        </div>
        <form
          onSubmit={submit}
          className="verse-surface mt-8 flex flex-col gap-3 rounded-2xl p-3 md:flex-row"
          role="search"
        >
          <div className="relative flex-1">
            <label htmlFor="network-search" className="sr-only">
              Search Verse
            </label>
            <Search className="absolute left-3.5 top-3.5 text-slate-400" size={18} />
            <Input
              id="network-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-12 border-white/15 bg-black/20 pl-11"
              placeholder="Role, instrument, genre, city or skill…"
            />
          </div>
          <label htmlFor="search-type" className="sr-only">
            Result type
          </label>
          <select
            id="search-type"
            value={selectedType}
            onChange={(e) => (q.trim() ? searchFor(q.trim(), e.target.value) : setSp({ type: e.target.value }))}
            className="h-12 rounded-xl border border-white/15 bg-[#101323] px-4"
          >
            <option value="all">Everything</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type][0]}
              </option>
            ))}
          </select>
          <Button className="h-12 px-6" disabled={!q.trim() || (searched && loading)}>
            {searched && loading ? 'Searching…' : 'Search'}
          </Button>
        </form>
        {!searched && (
          <div className="mt-5">
            <div className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Popular right now</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((x) => (
                <button
                  key={x}
                  onClick={() => searchFor(x)}
                  className="rounded-full border border-white/15 bg-white/[.055] px-3.5 py-2 text-sm text-slate-300 hover:border-violet-300/40 hover:bg-violet-400/10 hover:text-white"
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
        )}
        {searched && !loading && <SearchNotice meta={meta} query={query.trim()} />}
        {searched && !loading && interpreted.length > 1 && (
          <div className="mt-4 text-sm text-violet-200">Related terms included: {interpreted.slice(1).join(' · ')}</div>
        )}
        {recent.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span>Recent</span>
            {recent.map((x) => (
              <button
                key={x}
                onClick={() => searchFor(x)}
                className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                {x}
              </button>
            ))}
          </div>
        )}
        {searched && error && (
          <div className="mt-8 rounded-2xl border border-rose-300/25 bg-rose-400/10 p-5 text-rose-100" role="alert">
            Search is taking a breather. Please try again in a moment.
          </div>
        )}
        <div className="mt-8 grid gap-3" aria-live="polite">
          {!searched || loading || error ? null : results.length === 0 ? (
            <div className="verse-surface rounded-2xl">
              <NoResults
                noun="results"
                query={query.trim()}
                meta={meta}
                onSearch={(term) => searchFor(term)}
                suggestions={suggestions}
                onClear={selectedType !== 'all' ? () => searchFor(query.trim(), 'all') : undefined}
              />
            </div>
          ) : (
            results.map((r, index) => {
              const Icon = icons[r.type] || Search;
              const startsGroup = selectedType === 'all' && (index === 0 || results[index - 1].type !== r.type);
              const total = first?.totals?.[r.type];
              return (
                <div key={`${r.type}-${r.id}`} className="grid gap-3">
                  {startsGroup && (
                    <div
                      className="mt-3 flex flex-wrap items-baseline justify-between gap-2"
                      data-testid={`group-${r.type}`}
                    >
                      <div className="text-sm font-bold uppercase tracking-[.14em] text-slate-300">
                        {TYPE_LABELS[r.type][0]}
                        {typeof total === 'number' && <span className="ml-2 text-slate-500">{total}</span>}
                      </div>
                      {first?.moreOf?.[r.type] && (
                        <button
                          type="button"
                          onClick={() => searchFor(query.trim(), r.type)}
                          className="text-sm text-violet-300 hover:text-violet-200 hover:underline"
                        >
                          See all {total} {TYPE_LABELS[r.type][1]}
                        </button>
                      )}
                    </div>
                  )}
                  <Link to={r.url} className="group" data-list-item={index}>
                    <Card className="verse-card-lift border-white/15 bg-white/[.045]">
                      <CardContent className="flex gap-4 p-5">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-400/10">
                          <Icon size={19} className="text-violet-200" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-slate-400">
                            {r.type}
                            <DemoBadge show={r.demo} />
                          </div>
                          <h2 className="mt-1 text-lg font-bold group-hover:text-violet-200">{r.title}</h2>
                          {r.subtitle && <div className="mt-0.5 text-sm text-violet-200">{r.subtitle}</div>}
                          {r.description && <p className="mt-2 line-clamp-2 text-sm text-slate-300">{r.description}</p>}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(r.tags || []).slice(0, 6).map((x: string) => (
                              <Badge key={x} variant="secondary">
                                {x}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </div>
              );
            })
          )}
        </div>
        {searched && !loading && !error && selectedType !== 'all' && (
          <LoadMore
            shown={results.length}
            total={list.total}
            hasMore={list.hasMore}
            loading={list.loadingMore}
            error={list.moreError}
            onLoadMore={list.loadMore}
            noun={[TYPE_LABELS[selectedType][1].replace(/s$/, ''), TYPE_LABELS[selectedType][1]]}
          />
        )}
        {searched && selectedType !== 'all' && (
          <p className="mt-6 text-sm">
            <Link to={`/search?q=${encodeURIComponent(query.trim())}`} className="text-violet-300 hover:underline">
              Search everything for “{query.trim()}”
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
