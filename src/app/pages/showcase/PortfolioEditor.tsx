import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Copy, ExternalLink, Eye, Filter, Layers, Pencil, Settings2, Star, Trash2, UserRound } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AppSelect } from '../../components/ui/app-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { EmptyState } from '../../components/kit/EmptyState';
import { AiSuggestButton } from '../../components/ai/AiSuggestButton';
import {
  copyLink,
  LoadState,
  Panel,
  ShowcaseShell,
  StateActions,
  StateBadge,
  useWorkspaceBase,
} from '../../components/showcase/parts';
import { PortfolioRulesEditor, RulesSentence } from '../../components/showcase/RulesEditor';
import { InheritedField } from '../../components/showcase/InheritedField';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { PortfolioPreview } from '../../components/showcase/PortfolioPreview';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useActingAsKey } from '../../lib/actingAs';
import {
  cleanRules,
  computeMembers,
  isOverridden,
  itemState,
  matchesRules,
  publicPortfolioUrl,
  VISIBILITY_OPTIONS,
  type InheritedField as InheritedName,
  type Portfolio,
  type Rules,
} from '../../lib/showcase';
import type { PortfolioItem } from '../../lib/apiTypes';

type Show = 'in' | 'out' | 'all';

export default function PortfolioEditor() {
  const { id = '' } = useParams();
  const base = useWorkspaceBase();
  const nav = useNavigate();
  const actingAs = useActingAsKey();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [library, setLibrary] = useState<PortfolioItem[] | null>(null);
  const [error, setError] = useState('');
  const [rules, setRules] = useState<Rules>({});
  const [editingRules, setEditingRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Show>('in');
  const [title, setTitle] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const accept = useCallback((p: Portfolio) => {
    setPortfolio(p);
    setRules(p.rules || {});
  }, []);
  const load = useCallback(() => {
    setError('');
    apiGet<{ portfolio: Portfolio }>(`/portfolios/${encodeURIComponent(id)}`)
      .then((d) => accept(d.portfolio))
      .catch((e: unknown) => setError(errorMessage(e, 'This portfolio could not be loaded.')));
    apiGet<{ items?: PortfolioItem[] }>('/portfolio')
      .then((d) => setLibrary(d.items || []))
      .catch(() => setLibrary(null));
  }, [id, accept]);
  useEffect(load, [load, actingAs]);

  const pinned = portfolio?.pinnedItemIds || [];
  const excluded = portfolio?.excludedItemIds || [];
  const members = useMemo(() => {
    if (!portfolio) return [];
    if (!library || !library.length) return portfolio.items || [];
    return computeMembers(library, rules, portfolio.pinnedItemIds, portfolio.excludedItemIds);
  }, [portfolio, library, rules]);
  const pool: PortfolioItem[] = library && library.length ? library : (portfolio?.items || []).map((m) => m.item);
  const rows = pool
    .map((item) => ({ item, state: itemState(item.id, { pinned, excluded }, matchesRules(item, rules)) }))
    .filter(({ state }) =>
      show === 'all'
        ? true
        : show === 'in'
          ? state === 'rule' || state === 'pinned'
          : state === 'out' || state === 'excluded',
    );

  async function run(action: () => Promise<{ portfolio: Portfolio }>, done?: string) {
    setBusy(true);
    try {
      const out = await action();
      accept(out.portfolio);
      if (done) toast.success(done);
      return true;
    } catch (e: unknown) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const path = `/portfolios/${encodeURIComponent(id)}`;
  const patch = (body: Record<string, unknown>, done?: string) => run(() => apiPatch(path, body), done);
  const setItem = (itemId: string, state: 'pinned' | 'excluded' | 'auto') =>
    run(() => apiPut(`${path}/items/${encodeURIComponent(itemId)}`, { state }));
  const reset = (field: InheritedName) =>
    run(() => apiPost(`${path}/reset`, { fields: [field] }), 'Back to your profile’s version');

  if (!portfolio)
    return (
      <ShowcaseShell title="Portfolio" back={{ to: `${base}/portfolios`, label: 'All portfolios' }}>
        <LoadState error={error} onRetry={load} />
      </ShowcaseShell>
    );

  const url = publicPortfolioUrl(portfolio.slug);
  const masterLabel = portfolio.ownerType === 'user' ? 'your profile' : `${portfolio.ownerName || 'the Page'}`;
  const inherited = (field: InheritedName, label: string, kind: 'text' | 'textarea' | 'genres' | 'rates') => (
    <InheritedField
      key={field}
      id={`portfolio-${field}`}
      label={label}
      kind={kind}
      value={portfolio[field]}
      master={portfolio.master?.[field]}
      overridden={isOverridden(portfolio, field)}
      masterLabel={masterLabel}
      busy={busy}
      onSave={(value) => patch({ [field]: value }, `${label} saved for this portfolio`)}
      onReset={() => reset(field)}
      ai={
        field === 'bio'
          ? (draft, set) => (
              <AiSuggestButton
                task="portfolio_blurb"
                value={draft}
                getContext={() => ({
                  title: portfolio.title,
                  genres: portfolio.genres || [],
                  roles: rules.any?.roles || rules.only?.roles || [],
                  highlights: members.slice(0, 5).map((m) => m.item.title),
                })}
                onAccept={set}
              />
            )
          : undefined
      }
    />
  );
  const rulesDirty = JSON.stringify(cleanRules(rules)) !== JSON.stringify(cleanRules(portfolio.rules || {}));

  return (
    <ShowcaseShell
      wide
      title={portfolio.title}
      description={portfolio.ownerType === 'user' ? undefined : `A portfolio of ${portfolio.ownerName}.`}
      back={{ to: `${base}/portfolios`, label: 'All portfolios' }}
      help={SHOWCASE_HELP.portfolioEditor}
      actions={
        portfolio.visibility !== 'private' ? (
          <Button variant="outline" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              Open public page
            </a>
          </Button>
        ) : undefined
      }
    >
      {portfolio.status === 'hidden' && (
        <p role="alert" className="mb-5 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          Moderators hid this portfolio. It has no public page and can’t be sent with applications.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Panel
            title="What’s in it"
            icon={Filter}
            actions={
              !editingRules && (
                <Button size="sm" variant="outline" onClick={() => setEditingRules(true)}>
                  <Pencil size={14} aria-hidden="true" />
                  Edit rules
                </Button>
              )
            }
          >
            <RulesSentence rules={rules} />
            {editingRules && (
              <div className="mt-5 border-t border-white/10 pt-5">
                <PortfolioRulesEditor rules={rules} onChange={setRules} />
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    disabled={busy || !rulesDirty}
                    onClick={async () => {
                      if (await patch({ rules: cleanRules(rules) }, 'Rules saved')) setEditingRules(false);
                    }}
                  >
                    Save rules
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRules(portfolio.rules || {});
                      setEditingRules(false);
                    }}
                  >
                    {rulesDirty ? 'Discard changes' : 'Done'}
                  </Button>
                  {rulesDirty && (
                    <span className="self-center text-xs text-amber-200">The preview shows your unsaved rules.</span>
                  )}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Work" icon={Layers}>
            <div role="radiogroup" aria-label="Show" className="mb-4 inline-flex rounded-xl border border-white/10 p-1">
              {(
                [
                  ['in', 'In this portfolio'],
                  ['out', 'Left out'],
                  ['all', 'Everything'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={show === value}
                  onClick={() => setShow(value)}
                  className={`min-h-9 rounded-lg px-3 text-sm ${show === value ? 'bg-violet-500/25 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <EmptyState icon={Layers} title={show === 'in' ? 'Nothing matches yet' : 'Nothing left out'}>
                {show === 'in'
                  ? 'Loosen the rules, or pin a piece from “Left out”.'
                  : 'Every piece of your work is in this portfolio.'}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-white/10">
                {rows.map(({ item, state }) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="portfolio-row">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-medium break-words">{item.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <StateBadge state={state} />
                        {[...(item.roles || []), ...(item.genres || [])].slice(0, 3).join(' · ')}
                      </p>
                    </div>
                    <StateActions
                      state={state}
                      name={item.title}
                      busy={busy}
                      onChange={(s) => void setItem(item.id, s)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Details" icon={UserRound}>
            <p className="-mt-2 mb-4 text-sm text-slate-400">
              These come from {masterLabel} and stay in sync. Override one only when this portfolio needs a different
              version.
            </p>
            {inherited('headline', 'Headline', 'text')}
            {inherited('bio', 'Bio', 'textarea')}
            {inherited('city', 'City', 'text')}
            {inherited('genres', 'Genres', 'genres')}
            {inherited('rates', 'Rates', 'rates')}
          </Panel>

          <Panel title="Sharing" icon={Settings2}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portfolio-title" className="text-sm font-medium text-slate-300">
                  Portfolio name
                </label>
                <Input
                  id="portfolio-title"
                  className="mt-1.5 border-white/15 bg-black/20"
                  value={title ?? portfolio.title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title !== null && title.trim() && title.trim() !== portfolio.title)
                      void patch({ title: title.trim() }, 'Name saved');
                    setTitle(null);
                  }}
                />
              </div>
              <div>
                <label htmlFor="portfolio-visibility" className="text-sm font-medium text-slate-300">
                  Who can see it
                </label>
                <AppSelect
                  id="portfolio-visibility"
                  className="mt-1.5"
                  value={portfolio.visibility}
                  onValueChange={(v) => void patch({ visibility: v }, 'Visibility saved')}
                  options={VISIBILITY_OPTIONS}
                />
              </div>
            </div>
            {portfolio.visibility !== 'private' && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2 pl-3">
                <code className="min-w-0 flex-1 truncate text-xs text-slate-300" data-testid="public-link">
                  {url}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copyLink(url)}>
                  <Copy size={14} aria-hidden="true" />
                  Copy link
                </Button>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {portfolio.isDefault ? (
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-amber-400/15 px-3 text-sm text-amber-200">
                  <Star size={14} aria-hidden="true" />
                  Your default for applications
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => apiPost(`${path}/default`), 'Set as default')}
                >
                  <Star size={14} aria-hidden="true" />
                  Set as default
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-rose-300" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} aria-hidden="true" />
                Delete portfolio
              </Button>
            </div>
          </Panel>
        </div>

        <aside aria-label="Live preview" className="lg:sticky lg:top-24 lg:self-start">
          <Panel title="Live preview" icon={Eye}>
            <PortfolioPreview portfolio={portfolio} members={members} />
          </Panel>
        </aside>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="border-white/10 bg-slate-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{portfolio.title}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Your work stays in your library. The public link stops working. Applications already sent keep their copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-500"
              onClick={async () => {
                try {
                  await apiDelete(path);
                  toast.success('Portfolio deleted');
                  nav(`${base}/portfolios`);
                } catch (e: unknown) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Delete portfolio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="mt-6 text-sm text-slate-500">
        Adding new work? Do it once in{' '}
        <Link className="text-violet-300 underline" to={`${base}/library`}>
          My work
        </Link>
        ; it joins here when it matches.
      </p>
    </ShowcaseShell>
  );
}
