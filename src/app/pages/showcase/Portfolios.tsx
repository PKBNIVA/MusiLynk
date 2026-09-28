import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Copy, Globe2, Layers, Link2, Lock, Plus, Star } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/help/EmptyState';
import { copyLink, LoadState, ShowcaseShell, useWorkspaceBase } from '../../components/showcase/parts';
import { RulesSentence } from '../../components/showcase/RulesEditor';
import { SHOWCASE_HELP } from '../../components/showcase/help';
import { apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useActingAsKey } from '../../lib/actingAs';
import { publicPortfolioUrl, type Portfolio } from '../../lib/showcase';

const VIS = {
  public: { icon: Globe2, label: 'Public' },
  link: { icon: Link2, label: 'Link only' },
  private: { icon: Lock, label: 'Private' },
};

export default function Portfolios() {
  const base = useWorkspaceBase();
  const actingAs = useActingAsKey();
  const [list, setList] = useState<Portfolio[] | null>(null);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    setList(null);
    apiGet<{ portfolios?: Portfolio[]; limit?: number }>('/portfolios')
      .then((d) => {
        setList(d.portfolios || []);
        if (d.limit) setLimit(d.limit);
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Your portfolios could not be loaded.')));
  }, []);
  useEffect(load, [load, actingAs]);

  async function makeDefault(p: Portfolio) {
    try {
      await apiPost(`/portfolios/${p.id}/default`);
      setList((l) => (l || []).map((x) => ({ ...x, isDefault: x.id === p.id })));
      toast.success(`“${p.title}” is now your default`);
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }

  const full = (list?.length || 0) >= limit;
  return (
    <ShowcaseShell
      title="Portfolios"
      description="Each portfolio is a view of your work for one purpose. Add work once and every matching portfolio picks it up."
      help={SHOWCASE_HELP.portfolios}
      actions={
        <>
          <Button variant="outline" asChild>
            <Link to={`${base}/library`}>My work</Link>
          </Button>
          {full ? (
            <Button disabled title={`You can have up to ${limit} portfolios`}>
              <Plus size={16} aria-hidden="true" />
              New portfolio
            </Button>
          ) : (
            <Button asChild>
              <Link to={`${base}/portfolios/new`}>
                <Plus size={16} aria-hidden="true" />
                New portfolio
              </Link>
            </Button>
          )}
        </>
      }
    >
      {list === null ? (
        <LoadState error={error} onRetry={load} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No portfolios yet"
          action={
            <Button asChild>
              <Link to={`${base}/portfolios/new`}>
                <Plus size={16} aria-hidden="true" />
                New portfolio
              </Link>
            </Button>
          }
        >
          Describe a goal like “jazz sessions” and we’ll pick the matching work for you to trim.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {list.map((p) => {
            const vis = VIS[p.visibility] || VIS.private;
            return (
              <li
                key={p.id}
                className="flex flex-col rounded-2xl border border-white/10 bg-white/[.055] p-5"
                data-testid="portfolio-card"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {p.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-200">
                      <Star size={12} aria-hidden="true" />
                      Default
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-2 py-0.5 text-slate-300">
                    <vis.icon size={12} aria-hidden="true" />
                    {vis.label}
                  </span>
                  {p.status === 'hidden' && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-200">Hidden by moderators</span>
                  )}
                </div>
                <h2 className="mt-3 text-xl font-semibold break-words">
                  <Link
                    to={`${base}/portfolios/${p.id}`}
                    className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    {p.title}
                  </Link>
                </h2>
                <RulesSentence rules={p.rules} className="mt-1 text-sm text-slate-400" />
                <p className="mt-2 text-sm text-slate-300">
                  {p.itemCount ?? 0} piece{p.itemCount === 1 ? '' : 's'} of work
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <Button size="sm" asChild>
                    <Link to={`${base}/portfolios/${p.id}`}>
                      Edit<span className="sr-only"> {p.title}</span>
                    </Link>
                  </Button>
                  {!p.isDefault && (
                    <Button size="sm" variant="outline" onClick={() => void makeDefault(p)}>
                      Set as default<span className="sr-only">: {p.title}</span>
                    </Button>
                  )}
                  {p.visibility !== 'private' && (
                    <Button size="sm" variant="ghost" onClick={() => void copyLink(publicPortfolioUrl(p.slug))}>
                      <Copy size={14} aria-hidden="true" />
                      Copy link<span className="sr-only"> to {p.title}</span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ShowcaseShell>
  );
}
