import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Check, CheckCheck, Inbox, Sparkles, Tags, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/help/EmptyState';
import { LoadState, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useActingAsKey } from '../../lib/actingAs';
import { announceSuggestionsChanged, suggestionQuestion, type Suggestion } from '../../lib/showcase';

type Tab = 'pending' | 'all';
const STATUS_LABEL: Record<Suggestion['status'], string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  rejected: 'Rejected',
  obsolete: 'No longer needed',
};

export default function ReviewInbox() {
  const base = useWorkspaceBase();
  const actingAs = useActingAsKey();
  const [tab, setTab] = useState<Tab>('pending');
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    setList(null);
    apiGet<{ suggestions?: Suggestion[] }>(`/suggestions?status=${tab}`)
      .then((d) => setList(d.suggestions || []))
      .catch((e: unknown) => setError(errorMessage(e, 'Suggestions could not be loaded.')));
  }, [tab]);
  useEffect(load, [load, actingAs]);

  const targetLink = (s: Suggestion) =>
    s.target.type === 'portfolio'
      ? `${base}/portfolios/${s.target.id}`
      : s.target.type === 'resume'
        ? `${base}/resumes/${s.target.id}`
        : `${base}/library`;

  async function decide(s: Suggestion, action: 'accept' | 'reject') {
    setBusy(s.id);
    try {
      // Literal paths, so the API contract test can match each call to its route.
      const path = action === 'accept' ? `/suggestions/${s.id}/accept` : `/suggestions/${s.id}/reject`;
      const out = await apiPost<{ suggestion: Suggestion; applied?: boolean }>(path);
      setList((l) =>
        (l || [])
          .map((x) => (x.id === s.id ? out.suggestion : x))
          .filter((x) => tab === 'all' || x.status === 'pending'),
      );
      if (action === 'accept')
        out.applied === false
          ? toast.message('That item or view is gone, so there was nothing to change.')
          : toast.success('Done. The change is live.');
      announceSuggestionsChanged();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function acceptAll() {
    setBusy('all');
    try {
      const out = await apiPost<{ accepted?: string[]; obsolete?: string[] }>('/suggestions/accept-all');
      const n = (out.accepted || []).length;
      toast.success(`Accepted ${n} suggestion${n === 1 ? '' : 's'}`);
      announceSuggestionsChanged();
      load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const pending = (list || []).filter((s) => s.status === 'pending');
  return (
    <ShowcaseShell
      title="Review changes"
      description="When new work almost fits a portfolio, or its description mentions something it isn’t tagged with, we ask here first."
      help={SHOWCASE_HELP.review}
      actions={
        tab === 'pending' &&
        pending.length > 1 && (
          <Button onClick={() => void acceptAll()} disabled={busy !== null}>
            <CheckCheck size={16} aria-hidden="true" />
            Accept all ({pending.length})
          </Button>
        )
      }
    >
      <div
        role="tablist"
        aria-label="Which suggestions"
        className="mb-5 inline-flex rounded-xl border border-white/10 p-1"
      >
        {(
          [
            ['pending', 'To review'],
            ['all', 'History'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-9 rounded-lg px-4 text-sm ${tab === value ? 'bg-violet-500/25 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {list === null ? (
        <LoadState error={error} onRetry={load} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tab === 'pending' ? 'You’re all caught up' : 'Nothing here yet'}
          action={
            <Button variant="outline" asChild>
              <Link to={`${base}/library`}>Go to my work</Link>
            </Button>
          }
        >
          New suggestions appear when you add or edit work, or your career record.
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {list.map((s) => {
            const Icon = s.kind === 'tags' ? Tags : Sparkles;
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-start gap-3 rounded-2xl border border-white/10 bg-white/[.055] p-4"
                data-testid="suggestion"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-medium text-white [overflow-wrap:anywhere]">{suggestionQuestion(s)}</p>
                  <p className="mt-0.5 text-sm text-slate-400">Why: {s.reason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {s.target.type === 'portfolio_item'
                      ? 'Work sample'
                      : s.target.type === 'resume'
                        ? 'Resume'
                        : 'Portfolio'}
                    :{' '}
                    <Link to={targetLink(s)} className="text-violet-300 underline-offset-2 hover:underline">
                      {s.target.title}
                    </Link>
                    {s.status !== 'pending' && ` · ${STATUS_LABEL[s.status]}`}
                  </p>
                </div>
                {s.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy !== null} onClick={() => void decide(s, 'accept')}>
                      <Check size={14} aria-hidden="true" />
                      Accept<span className="sr-only">: {suggestionQuestion(s)}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void decide(s, 'reject')}
                    >
                      <X size={14} aria-hidden="true" />
                      Reject<span className="sr-only">: {suggestionQuestion(s)}</span>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ShowcaseShell>
  );
}
