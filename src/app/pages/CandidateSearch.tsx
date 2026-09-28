import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../lib/authContext';
import type {
  Created,
  ConversationCreated,
  PortfolioItem,
  Professional,
  RecentActivity,
  TalentFolder,
} from '../lib/apiTypes';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Search, MapPin, BookmarkPlus, BookmarkCheck, MessageSquare, ShieldCheck, FolderPlus } from 'lucide-react';
import { WorkSamplePlayer } from '../components/WorkSamplePlayer';
import { Label } from '../components/ui/label';
import { FormDialog, fieldClass } from '../components/HiringDialog';
import { toastJobError } from '../components/OpportunityPipeline';
import { errorMessage } from '../lib/errors';
import { usePagedList, type PageMeta } from '../lib/usePagedList';
import { useUrlFilters } from '../lib/useUrlFilters';
import { LoadMore } from '../components/LoadMore';
import { NoResults, POPULAR_SEARCHES, SearchNotice } from '../components/SearchFeedback';

type CandidatePage = PageMeta & { candidates?: Professional[] };
const pickCandidates = (page: CandidatePage) => page.candidates;
// URL keys are the API's filter names, so the URL is the search.
const FILTERS = ['q', 'location', 'role', 'instrument', 'verified', 'remoteRecording'] as const;
const NOUN = ['professional', 'professionals'] as const;

export default function CandidateSearch() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [compare, setCompare] = useState<string[]>([]),
    [recent, setRecent] = useState<RecentActivity[]>([]);
  // Filters live in the URL (reload, share, Back undoes a change: SRCH-08); results are paged.
  const { values: f, query, update, clear } = useUrlFilters(FILTERS);
  const list = usePagedList<Professional, CandidatePage>({ path: '/candidates', pick: pickCandidates, noun: 'talent' });
  const { items, setItems, loading, error: loadError } = list;
  const [q, setQ] = useState(f.q),
    [location, setLocation] = useState(f.location),
    [role, setRole] = useState(f.role),
    [instrument, setInstrument] = useState(f.instrument),
    [selected, setSelected] = useState<Professional | null>(null),
    [portfolio, setPortfolio] = useState<PortfolioItem[]>([]),
    [folderFor, setFolderFor] = useState<Professional | null>(null),
    [folders, setFolders] = useState<TalentFolder[] | null>(null),
    [folderChoice, setFolderChoice] = useState(''),
    [newFolder, setNewFolder] = useState(''),
    [folderBusy, setFolderBusy] = useState(false);
  useEffect(() => {
    setQ(f.q);
    setLocation(f.location);
    setRole(f.role);
    setInstrument(f.instrument);
  }, [f.q, f.location, f.role, f.instrument]);
  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    void load();
  }, [query, load]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!update({ q, location, role, instrument })) void load();
  };
  useEffect(() => {
    apiGet<{ items?: RecentActivity[] }>('/recent-activity')
      .then((d) =>
        setRecent((d.items || []).filter((x) => x.kind === 'profile_view' || x.kind === 'search').slice(0, 6)),
      )
      .catch(() => {});
  }, []);
  async function shortlist(c: Professional) {
    try {
      c.shortlisted ? await apiDelete(`/shortlists/${c.id}`) : await apiPost(`/shortlists/${c.id}`, {});
      setItems((xs) => xs.map((x) => (x.id === c.id ? { ...x, shortlisted: !x.shortlisted } : x)));
      toast.success(c.shortlisted ? 'Removed from shortlist' : 'Added to talent shortlist');
    } catch (e: unknown) {
      toastJobError(e, user?.role === 'jobseeker' ? '/jobseeker/billing' : '/employer/billing', nav);
    }
  }
  async function inspect(c: Pick<Professional, 'id'>) {
    try {
      const d = await apiGet<{ candidate: Professional; portfolio?: PortfolioItem[] }>(`/candidates/${c.id}`);
      setSelected(d.candidate);
      setPortfolio(d.portfolio || []);
      /* On narrow screens the detail panel sits below the results; bring it into view. */ if (window.innerWidth < 1024)
        requestAnimationFrame(() =>
          document.getElementById('talent-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        );
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function message(c: Professional) {
    try {
      const d = await apiPost<ConversationCreated>('/conversations', { candidateId: c.id });
      nav(`${user?.role === 'jobseeker' ? '/jobseeker' : '/employer'}/messages?conversation=${d.conversation.id}`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  async function addFolder(c: Professional) {
    setFolderFor(c);
    setFolders(null);
    setNewFolder('');
    setFolderChoice('');
    try {
      const d = await apiGet<{ folders?: TalentFolder[] }>('/talent-folders');
      const list = d.folders || [];
      setFolders(list);
      setFolderChoice(list[0]?.id || 'new');
      if (!list.length) setNewFolder('Shortlist');
    } catch (e: unknown) {
      toast.error(errorMessage(e));
      setFolderFor(null);
    }
  }
  async function saveFolder() {
    if (!folderFor) return;
    const creating = folderChoice === 'new';
    const name = newFolder.trim();
    if (creating && !name) {
      toast.error('Name the new folder');
      return;
    }
    setFolderBusy(true);
    try {
      let target = folders?.find((x) => x.id === folderChoice);
      if (creating) {
        const n = await apiPost<Created>('/talent-folders', { name });
        target = { id: n.id, name };
      }
      if (!target) return;
      await apiPost(`/talent-folders/${target.id}/candidates/${folderFor.id}`, {});
      toast.success(`Added ${folderFor.name} to ${target.name}`);
      setFolderFor(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setFolderBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="mb-7">
          <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Talent network</div>
          <h1 className="text-4xl md:text-5xl font-bold">Search by proof, skill and context</h1>
          <p className="text-slate-400 mt-3 max-w-3xl">
            Music careers are not resumés alone. Look for relevant credits, portfolio work, instruments, genres,
            languages, location and availability.
          </p>
        </div>
        <Card className="bg-white/[.055] border-white/10 mb-7">
          <CardContent className="p-4">
            <form onSubmit={submit} className="grid md:grid-cols-2 lg:grid-cols-5 gap-3" role="search">
              <Input
                aria-label="Skill, credit, gear or software"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Skill, credit, gear, DAW…"
                className="bg-black/20 border-white/15"
              />
              <Input
                aria-label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Mumbai, Bengaluru…"
                className="bg-black/20 border-white/15"
              />
              <Input
                aria-label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Role: FOH, singer…"
                className="bg-black/20 border-white/15"
              />
              <Input
                aria-label="Instrument"
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                placeholder="Instrument"
                className="bg-black/20 border-white/15"
              />
              <Button>
                <Search size={16} className="mr-2" />
                Search
              </Button>
            </form>
            <div className="flex flex-wrap gap-5 mt-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <Checkbox
                  checked={f.verified === 'true'}
                  onCheckedChange={(v) => update({ verified: v ? 'true' : '' })}
                />
                Verified only
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <Checkbox
                  checked={f.remoteRecording === 'true'}
                  onCheckedChange={(v) => update({ remoteRecording: v ? 'true' : '' })}
                />
                Remote recording ready
              </label>
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
          <div className="text-sm text-slate-500">
            {recent.length ? (
              <>
                Recent:{' '}
                {recent.slice(0, 4).map((r) => (
                  <button
                    key={r.id}
                    className="ml-2 text-slate-300 hover:text-white"
                    onClick={() => {
                      if (r.kind === 'search') {
                        update({ q: r.query || '' });
                      } else if (r.entityId) {
                        inspect({ id: r.entityId });
                      }
                    }}
                  >
                    {r.label || r.query}
                  </button>
                ))}
              </>
            ) : (
              <>Select 2–4 people to compare proof and rates.</>
            )}
          </div>
          {compare.length >= 2 && (
            <Button
              onClick={() =>
                nav(`${user?.role === 'employer' ? '/employer' : '/jobseeker'}/compare?ids=${compare.join(',')}`)
              }
            >
              Compare {compare.length} professionals
            </Button>
          )}
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
          <div className="grid md:grid-cols-2 gap-4 content-start">
            {loading ? (
              <Card className="bg-white/[.035] border-white/10 md:col-span-2">
                <CardContent className="p-8 text-center text-slate-400" role="status">
                  Loading talent…
                </CardContent>
              </Card>
            ) : loadError ? (
              <Card className="bg-white/[.035] border-white/10 md:col-span-2">
                <CardContent className="p-8 text-center" role="alert">
                  <p className="text-rose-300">{loadError}</p>
                  <Button className="mt-4" variant="outline" onClick={() => void load()}>
                    Try again
                  </Button>
                </CardContent>
              </Card>
            ) : (
              !items.length && (
                <Card className="bg-white/[.035] border-white/10 md:col-span-2">
                  <CardContent className="p-2">
                    <NoResults
                      noun="professionals"
                      query={f.q}
                      meta={list.meta}
                      onSearch={(term) => update({ q: term })}
                      suggestions={POPULAR_SEARCHES}
                      onClear={query ? clear : undefined}
                    />
                  </CardContent>
                </Card>
              )
            )}
            {!loading && !loadError && items.length > 0 && (
              <div className="md:col-span-2 -mt-2">
                <SearchNotice meta={list.meta} query={f.q} />
              </div>
            )}
            {!loading &&
              !loadError &&
              items.map((c, index) => (
                <Card key={c.id} className="bg-white/[.055] border-white/10" data-list-item={index} tabIndex={-1}>
                  <CardContent className="p-5">
                    <div className="flex justify-between gap-3">
                      <div className="flex gap-3 items-start">
                        <Checkbox
                          aria-label={`Compare ${c.name}`}
                          checked={compare.includes(c.id)}
                          onCheckedChange={(v) =>
                            setCompare((xs) =>
                              v ? [...xs.filter((x) => x !== c.id), c.id].slice(-4) : xs.filter((x) => x !== c.id),
                            )
                          }
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-xl font-semibold">{c.name}</h2>
                            {c.verified && <ShieldCheck size={17} className="text-emerald-300" />}
                          </div>
                          <p className="text-violet-300">{c.headline || 'Music professional'}</p>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={c.shortlisted ? `Remove ${c.name} from shortlist` : `Shortlist ${c.name}`}
                        aria-pressed={!!c.shortlisted}
                        onClick={() => shortlist(c)}
                      >
                        {c.shortlisted ? <BookmarkCheck className="text-violet-300" /> : <BookmarkPlus />}
                      </Button>
                    </div>
                    {c.location && (
                      <div className="text-sm text-slate-400 mt-3 flex">
                        <MapPin size={15} className="mr-1" />
                        {c.location}
                      </div>
                    )}
                    <p className="text-sm text-slate-300 mt-3 line-clamp-3">{c.bio || 'No bio added yet.'}</p>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {c.skills?.slice(0, 6).map((s: string) => (
                        <Badge variant="secondary" key={s}>
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-5">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => inspect(c)}>
                        View proof
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Add to folder"
                        aria-label={`Add ${c.name} to a folder`}
                        onClick={() => addFolder(c)}
                      >
                        <FolderPlus size={16} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Message"
                        aria-label={`Message ${c.name}`}
                        onClick={() => message(c)}
                      >
                        <MessageSquare size={16} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            {!loading && !loadError && (
              <div className="md:col-span-2">
                <LoadMore
                  shown={items.length}
                  total={list.total}
                  hasMore={list.hasMore}
                  loading={list.loadingMore}
                  error={list.moreError}
                  onLoadMore={list.loadMore}
                  noun={NOUN}
                />
              </div>
            )}
          </div>
          <aside id="talent-detail" className="scroll-mt-24" aria-live="polite">
            {selected ? (
              <Card className="bg-white/[.06] border-white/10 sticky top-24">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-semibold">{selected.name}</h2>
                    {selected.verified && <ShieldCheck className="text-emerald-300" />}
                  </div>
                  <p className="text-violet-300 mt-1">{selected.headline}</p>
                  <p className="text-sm text-slate-300 mt-4 leading-6">{selected.bio}</p>
                  {!!selected.credits?.length && (
                    <div className="mt-5">
                      <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Credits</div>
                      {selected.credits.slice(0, 8).map((x: string) => (
                        <div className="text-sm py-1" key={x}>
                          • {x}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-5">
                    <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Portfolio</div>
                    {portfolio.length ? (
                      <div className="space-y-2">
                        {portfolio.map((p) => (
                          <WorkSamplePlayer key={p.id} sample={p} compact />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No portfolio items yet.</p>
                    )}
                  </div>
                  <Button className="w-full mt-5" onClick={() => message(selected)}>
                    <MessageSquare size={16} className="mr-2" />
                    Message professional
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-white/[.035] border-white/10">
                <CardContent className="p-8 text-center text-slate-500">
                  Select a professional to inspect portfolio and verified career proof.
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
        <FormDialog
          open={!!folderFor}
          onOpenChange={(o) => {
            if (!o) setFolderFor(null);
          }}
          title="Add to talent folder"
          description={folderFor ? `Save ${folderFor.name} to a folder you can revisit when hiring.` : undefined}
          submitLabel="Add to folder"
          busy={folderBusy}
          submitDisabled={folders === null || (folderChoice === 'new' && !newFolder.trim())}
          onSubmit={saveFolder}
        >
          {folders === null ? (
            <p className="text-sm text-slate-400" role="status">
              Loading folders…
            </p>
          ) : (
            <>
              {folders.length > 0 && (
                <div>
                  <Label htmlFor="talent-folder">Folder</Label>
                  <select
                    id="talent-folder"
                    value={folderChoice}
                    onChange={(e) => setFolderChoice(e.target.value)}
                    className={fieldClass + ' bg-slate-900'}
                  >
                    {folders.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name || 'Untitled folder'}
                        {typeof x.count === 'number' ? ` (${x.count})` : ''}
                      </option>
                    ))}
                    <option value="new">+ New folder…</option>
                  </select>
                </div>
              )}
              {folderChoice === 'new' && (
                <div>
                  <Label htmlFor="talent-folder-name">New folder name</Label>
                  <input
                    id="talent-folder-name"
                    required
                    maxLength={80}
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    placeholder="e.g. Tour band shortlist"
                    className={fieldClass}
                  />
                </div>
              )}
            </>
          )}
        </FormDialog>
      </main>
    </div>
  );
}
