import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { FilePlus2, ListChecks, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { AppSelect } from '../../components/ui/app-select';
import { Field } from '../../components/form/Field';
import { EmptyState } from '../../components/help/EmptyState';
import { AiSuggestButton } from '../../components/ai/AiSuggestButton';
import { Panel, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { RulesSentence } from '../../components/showcase/RulesEditor';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { cn } from '../../components/ui/utils';
import {
  draftSelection,
  parseAiDraft,
  VISIBILITY_OPTIONS,
  type Portfolio,
  type PortfolioDraft,
} from '../../lib/showcase';
import type { PortfolioItem } from '../../lib/apiTypes';

type Path = 'goal' | 'blank';

export default function NewPortfolio() {
  const base = useWorkspaceBase();
  const nav = useNavigate();
  const [path, setPath] = useState<Path>('goal');
  const [goal, setGoal] = useState('');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [draft, setDraft] = useState<PortfolioDraft | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [blurb, setBlurb] = useState('');
  const [useBlurb, setUseBlurb] = useState(false);
  const [library, setLibrary] = useState<PortfolioItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<{ items?: PortfolioItem[] }>('/portfolio')
      .then((d) => setLibrary(d.items || []))
      .catch(() => setLibrary([]));
  }, []);

  async function propose() {
    if (!goal.trim()) {
      setError('Describe what this portfolio is for.');
      document.getElementById('portfolio-goal')?.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      const d = await apiPost<{ draft: PortfolioDraft }>('/portfolios/draft', {
        goal: goal.trim(),
        title: title.trim() || undefined,
      });
      setDraft(d.draft);
      setKept({});
      if (!title.trim() && d.draft.title) setTitle(d.draft.title);
    } catch (e: unknown) {
      setError(errorMessage(e, 'We couldn’t draft this portfolio. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = title.trim() || goal.trim().slice(0, 120);
    if (!name) {
      setError('Give the portfolio a name.');
      document.getElementById('portfolio-name')?.focus();
      return;
    }
    setBusy(true);
    try {
      const body =
        path === 'goal' && draft
          ? {
              title: name,
              purpose: draft.purpose || undefined,
              visibility,
              rules: draft.rules,
              ...draftSelection(draft, kept),
              ...(useBlurb && blurb ? { bio: blurb } : {}),
            }
          : { title: name, visibility, rules: {} };
      const out = await apiPost<{ id: string; portfolio: Portfolio }>('/portfolios', body);
      toast.success('Portfolio created');
      nav(`${base}/portfolios/${out.id || out.portfolio.id}`);
    } catch (e: unknown) {
      setError(errorMessage(e, 'The portfolio could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  const keptCount = draft ? draft.items.filter((i) => kept[i.itemId] ?? i.included).length : 0;
  const choices = [
    {
      value: 'goal' as const,
      icon: Wand2,
      title: 'Start from a goal',
      text: 'Describe it; we pick the matching work and you remove what doesn’t fit.',
    },
    {
      value: 'blank' as const,
      icon: FilePlus2,
      title: 'Start blank',
      text: 'Set your own rules and pins from scratch.',
    },
  ];

  return (
    <ShowcaseShell
      title="New portfolio"
      back={{ to: `${base}/portfolios`, label: 'All portfolios' }}
      help={SHOWCASE_HELP.newPortfolio}
    >
      <div role="radiogroup" aria-label="How to start" className="mb-6 grid gap-3 sm:grid-cols-2">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={path === c.value}
            onClick={() => setPath(c.value)}
            className={cn(
              'flex items-start gap-3 rounded-2xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
              path === c.value
                ? 'border-violet-400/50 bg-violet-500/15'
                : 'border-white/10 bg-white/[.03] hover:border-white/20',
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
              <c.icon size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-white">{c.title}</span>
              <span className="mt-0.5 block text-sm text-slate-400">{c.text}</span>
            </span>
          </button>
        ))}
      </div>

      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="portfolio-name"
            label="Name"
            optional={path === 'goal'}
            hint={path === 'goal' ? 'We’ll suggest one from your goal.' : undefined}
          >
            <Input
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Film scoring reel"
              className="border-white/15 bg-black/20"
            />
          </Field>
          <div>
            <label htmlFor="portfolio-new-visibility" className="text-sm font-medium text-slate-300">
              Who can see it
            </label>
            <AppSelect
              id="portfolio-new-visibility"
              className="mt-1.5"
              value={visibility}
              onValueChange={setVisibility}
              options={VISIBILITY_OPTIONS}
            />
          </div>
        </div>
        {path === 'goal' && (
          <div className="mt-4 space-y-3">
            <Field
              id="portfolio-goal"
              label="What is it for?"
              required
              error={error && !draft ? error : undefined}
              hint="For example: jazz sessions, film scoring reel for OTT, wedding band gigs."
            >
              <Textarea
                value={goal}
                maxLength={500}
                onChange={(e) => setGoal(e.target.value)}
                className="min-h-20 border-white/15 bg-black/20"
              />
            </Field>
            <Button onClick={() => void propose()} disabled={busy} aria-busy={busy}>
              <ListChecks size={16} aria-hidden="true" />
              {draft ? 'Try again with this goal' : 'Pick my matching work'}
            </Button>
          </div>
        )}
        {path === 'blank' && (
          <div className="mt-5">
            {error && (
              <p role="alert" className="mb-3 text-sm text-rose-300">
                {error}
              </p>
            )}
            <Button onClick={() => void create()} disabled={busy}>
              Create blank portfolio
            </Button>
          </div>
        )}
      </Panel>

      {path === 'goal' && draft && (
        <Panel className="mt-6" title="Remove what doesn’t fit" icon={ListChecks}>
          <div role="status" className="mb-4 space-y-1">
            <p className="text-sm text-slate-300" data-testid="draft-summary">
              Keeping {keptCount} of {draft.items.length}. Untick anything that doesn’t belong.
            </p>
            <RulesSentence rules={draft.rules} className="text-sm text-slate-400" />
            {draft.note && <p className="text-sm text-amber-200">{draft.note}</p>}
          </div>
          {library.length > 0 && (
            <div className="mb-4">
              <AiSuggestButton
                task="draft_portfolio"
                label="Ask AI to pick"
                getContext={() => ({
                  goal: goal.trim().slice(0, 300),
                  items: library.slice(0, 60).map((i) =>
                    JSON.stringify({
                      id: i.id,
                      title: i.title,
                      kind: i.type,
                      roles: i.roles,
                      genres: i.genres,
                      tags: i.tags,
                    }).slice(0, 380),
                  ),
                })}
                onAccept={(text) => {
                  const picked = parseAiDraft(
                    text,
                    draft.items.map((i) => i.itemId),
                  );
                  if (!picked) {
                    toast.error('The AI reply could not be read. Your picks are unchanged.');
                    return;
                  }
                  setKept(Object.fromEntries(draft.items.map((i) => [i.itemId, picked.itemIds.includes(i.itemId)])));
                  if (picked.title && !title.trim()) setTitle(picked.title);
                  if (picked.blurb) setBlurb(picked.blurb);
                  toast.success('AI picks applied. Check them before saving.');
                }}
              />
            </div>
          )}
          {draft.items.length === 0 ? (
            <EmptyState icon={Sparkles} title="Your library is empty">
              Add some work first; new portfolios pick from it.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/10">
              {draft.items.map((item) => {
                const on = kept[item.itemId] ?? item.included;
                return (
                  <li key={item.itemId} data-testid="draft-item">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-violet-400"
                        checked={on}
                        onChange={(e) => setKept((k) => ({ ...k, [item.itemId]: e.target.checked }))}
                      />
                      <span className="min-w-0">
                        <span className={cn('block font-medium', on ? 'text-white' : 'text-slate-500 line-through')}>
                          {item.title}
                        </span>
                        <span className="block text-xs text-slate-400">{item.reason}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {blurb && (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-violet-400"
                checked={useBlurb}
                onChange={(e) => setUseBlurb(e.target.checked)}
              />
              <span>
                <span className="block font-medium">Use the AI’s blurb as this portfolio’s bio</span>
                <span className="block text-slate-400">{blurb}</span>
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-300">
              {error}
            </p>
          )}
          <Button className="mt-5" onClick={() => void create()} disabled={busy} aria-busy={busy}>
            Create portfolio with {keptCount} piece{keptCount === 1 ? '' : 's'}
          </Button>
        </Panel>
      )}
    </ShowcaseShell>
  );
}
