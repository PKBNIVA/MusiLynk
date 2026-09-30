import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { toast } from 'sonner';
import { useAuth } from '../lib/authContext';
import type { Created, ConversationCreated, Professional, RecentActivity, TalentFolder } from '../lib/apiTypes';
import { useLatestCallback } from '../lib/useLatestCallback';
import { Search, BookmarkPlus, BookmarkCheck, MessageSquare, ShieldCheck, FolderPlus, Folder } from 'lucide-react';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { UserAvatar } from '../components/kit/UserAvatar';
import { EmptyState } from '../components/kit/EmptyState';
import { FirstSample } from '../components/talent/FirstSample';
import { Label } from '../components/ui/label';
import { FormDialog, fieldClass } from '../components/HiringDialog';
import { toastJobError } from '../components/OpportunityPipeline';
import { errorMessage } from '../lib/errors';
import { usePagedList, type PageMeta } from '../lib/usePagedList';
import { useUrlFilters } from '../lib/useUrlFilters';
import { LoadMore } from '../components/LoadMore';
import { SearchNotice } from '../components/SearchFeedback';
import { AppSelect } from '../components/ui/app-select';

type CandidatePage = PageMeta & { candidates?: Professional[] };
const pickCandidates = (page: CandidatePage) => page.candidates;
// URL keys are the API's filter names, so the URL is the search.
const FILTERS = ['q', 'location', 'role', 'instrument', 'verified', 'remoteRecording'] as const;
const NOUN = ['professional', 'professionals'] as const;

function FilterChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-9 rounded-full border px-3.5 text-sm ${
        pressed
          ? 'border-violet-400 bg-violet-500/20 text-white'
          : 'border-white/15 bg-white/[.04] text-slate-300 hover:bg-white/[.08]'
      }`}
    >
      {children}
    </button>
  );
}

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
    [folderFor, setFolderFor] = useState<Professional | null>(null),
    [folders, setFolders] = useState<TalentFolder[] | null>(null),
    [folderChoice, setFolderChoice] = useState(''),
    [newFolder, setNewFolder] = useState(''),
    [folderBusy, setFolderBusy] = useState(false);
  useEffect(() => {
    setQ(f.q);
    setLocation(f.location);
  }, [f.q, f.location]);
  const load = useLatestCallback(() => list.search(query));
  useEffect(() => {
    void load();
  }, [query, load]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!update({ q, location })) void load();
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
      <main className={`max-w-7xl mx-auto px-5 md:px-6 pt-28 ${compare.length ? 'pb-32' : 'pb-16'}`}>
        <PageHeader title="Find talent" />
        <form onSubmit={submit} className="mb-4 grid gap-3 md:grid-cols-[1fr_14rem_auto]" role="search">
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
          <Button>
            <Search size={16} className="mr-2" />
            Search
          </Button>
        </form>
        <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <FilterChip
            pressed={f.verified === 'true'}
            onClick={() => update({ verified: f.verified === 'true' ? '' : 'true' })}
          >
            Verified only
          </FilterChip>
          <FilterChip
            pressed={f.verified === 'pro'}
            onClick={() => update({ verified: f.verified === 'pro' ? '' : 'pro' })}
          >
            Verified Pro
          </FilterChip>
          <FilterChip
            pressed={f.remoteRecording === 'true'}
            onClick={() => update({ remoteRecording: f.remoteRecording === 'true' ? '' : 'true' })}
          >
            Remote recording ready
          </FilterChip>
          {recent.some((r) => r.kind === 'search') && (
            <span className="ml-2 text-sm text-slate-500">
              Recent:{' '}
              {recent
                .filter((r) => r.kind === 'search')
                .slice(0, 3)
                .map((r) => (
                  <button
                    key={r.id}
                    className="ml-2 text-slate-300 hover:text-white"
                    onClick={() => update({ q: r.query || '' })}
                  >
                    {r.label || r.query}
                  </button>
                ))}
            </span>
          )}
        </div>
        <div className="grid content-start gap-4 md:grid-cols-3">
          {loading ? (
            <Card className="bg-white/[.035] border-white/10 md:col-span-3">
              <CardContent className="p-8 text-center text-slate-400" role="status">
                Loading talent…
              </CardContent>
            </Card>
          ) : loadError ? (
            <Card className="bg-white/[.035] border-white/10 md:col-span-3">
              <CardContent className="p-8 text-center" role="alert">
                <p className="text-rose-300">{loadError}</p>
                <Button className="mt-4" variant="outline" onClick={() => void load()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : (
            !items.length && (
              <div className="md:col-span-3" data-testid="no-results">
                <EmptyState
                  scene="search"
                  title="No one matches yet"
                  hint="Try fewer filters or another city"
                  action={query ? { label: 'Clear filters', onClick: clear } : undefined}
                />
              </div>
            )
          )}
          {!loading && !loadError && items.length > 0 && (
            <div className="md:col-span-3 -mt-2">
              <SearchNotice meta={list.meta} query={f.q} />
            </div>
          )}
          {!loading &&
            !loadError &&
            items.map((c, index) => (
              <Card key={c.id} className="bg-white/[.055] border-white/10" data-list-item={index} tabIndex={-1}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <UserAvatar id={c.id} name={c.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h2 className="truncate text-lg font-semibold">
                          <Link to={`/professionals/${encodeURIComponent(c.id)}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </h2>
                        {c.verified && (
                          <ShieldCheck size={16} aria-label="Verified" className="shrink-0 text-emerald-300" />
                        )}
                        {c.verificationTier === 'verified_pro' && (
                          <VerifiedBadge verification={c.verification} tier={c.verificationTier} />
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-300">
                        {[
                          c.headline || c.roles?.[0] || 'Music professional',
                          c.genres?.slice(0, 2).join(', '),
                          c.location,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
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
                  <FirstSample id={c.id} className="mt-4" />
                  {!!c.skills?.length && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.skills.slice(0, 3).map((s: string) => (
                        <span key={s} className="rounded-full bg-white/[.06] px-2.5 py-0.5 text-xs text-slate-300">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => message(c)}>
                      <MessageSquare size={16} className="mr-2" />
                      Message
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
                    <label className="flex items-center gap-1.5 text-sm text-slate-300">
                      <Checkbox
                        aria-label={`Compare ${c.name}`}
                        className="tap-target-44"
                        checked={compare.includes(c.id)}
                        onCheckedChange={(v) =>
                          setCompare((xs) =>
                            v ? [...xs.filter((x) => x !== c.id), c.id].slice(-4) : xs.filter((x) => x !== c.id),
                          )
                        }
                      />
                      Compare
                    </label>
                  </div>
                </CardContent>
              </Card>
            ))}
          {!loading && !loadError && (
            <div className="md:col-span-3">
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
        {compare.length >= 1 && (
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur max-md:bottom-16"
            data-testid="compare-tray"
          >
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
              <ul className="flex items-center gap-2" aria-label="Selected to compare">
                {compare.map((id) => {
                  const c = items.find((x) => x.id === id);
                  return (
                    <li key={id}>
                      <UserAvatar id={id} name={c?.name || 'Selected professional'} size="sm" />
                    </li>
                  );
                })}
                {compare.length < 2 && <li className="text-sm text-slate-400">Pick one more to compare</li>}
              </ul>
              <Button
                disabled={compare.length < 2}
                onClick={() =>
                  nav(`${user?.role === 'employer' ? '/employer' : '/jobseeker'}/compare?ids=${compare.join(',')}`)
                }
              >
                Compare {compare.length}
              </Button>
            </div>
          </div>
        )}
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
                  <AppSelect
                    id="talent-folder"
                    value={folderChoice}
                    onValueChange={setFolderChoice}
                    className="mt-2"
                    options={[
                      ...folders.map((x) => ({
                        value: x.id,
                        label: `${x.name || 'Untitled folder'}${typeof x.count === 'number' ? ` (${x.count})` : ''}`,
                        icon: Folder,
                      })),
                      { value: 'new', label: 'New folder…', icon: FolderPlus },
                    ]}
                  />
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
