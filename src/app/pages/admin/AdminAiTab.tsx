import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';
import { errorMessage } from '../../lib/errors';
import { Panel, Empty } from './shared';
import { AdminPageHeader, HowToCallout } from './ui';

// GET /api/admin/ai/costs (Admin::AiController#costs) — see backend/docs/ai-assist.md.
type AiCosts = {
  provider: string;
  model: string;
  enabled: boolean;
  totalSpendInr: number;
  freeTierSpendInr: number;
  freeTierBudgetInr: number;
  hardBudgetInr: number;
  byTask: Record<string, number>;
  byTier: Record<string, number>;
  topAccounts: { accountType: string; accountId: string; spendInr: number }[];
};

const inr = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function BudgetBar({ label, used, budget }: { label: string; used: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-slate-300">{label}</span>
        <span className={pct >= 90 ? 'text-rose-300' : 'text-slate-400'}>
          {inr(used)} / {inr(budget)} ({pct}%)
        </span>
      </div>
      <Progress
        value={pct}
        aria-label={label}
        className={pct >= 90 ? '[&_[data-slot=progress-indicator]]:bg-rose-500' : undefined}
      />
    </div>
  );
}

// Launch mode: only profile_headline, profile_bio, job_description and job_screening_questions
// can ever appear here (everything else answers 403 AI_TASK_DISABLED before it's ever charged),
// and there is no grant-credits form — AI billing stays off, so there is nothing to grant against.
export default function AdminAiTab() {
  const [costs, setCosts] = useState<AiCosts | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiGet<AiCosts>('/admin/ai/costs')
      .then((d) => {
        setCosts(d);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Unable to load AI spend.')))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div>
      <AdminPageHeader
        icon={Sparkles}
        title="AI spend"
        description="This month's Verse AI spend and budget guardrails, for the free profile and job-post writing help."
      />
      <HowToCallout storageKey="ai">
        Spend is estimated from reported token usage and resets on the 1st (UTC). The <b>free-tier</b> and <b>hard</b>{' '}
        bars are the guardrails that pause AI help for the month once crossed.
      </HowToCallout>
      <Panel error={error} onRetry={load} loading={loading}>
        {costs && (
          <div className="grid xl:grid-cols-2 gap-5">
            <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>Spend this month</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {costs.provider && (
                  <p className="text-sm text-slate-400">
                    Provider: <b className="text-slate-200">{costs.provider}</b> · Model:{' '}
                    <b className="text-slate-200">{costs.model}</b>
                    {costs.enabled === false && <span className="text-rose-300"> · disabled (API key not set)</span>}
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-slate-400">Total spend</div>
                    <div className="text-2xl font-bold mt-1">{inr(costs.totalSpendInr)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Free-tier spend</div>
                    <div className="text-2xl font-bold mt-1">{inr(costs.freeTierSpendInr)}</div>
                  </div>
                </div>
                <BudgetBar label="Free-tier budget" used={costs.freeTierSpendInr} budget={costs.freeTierBudgetInr} />
                <BudgetBar label="Hard monthly budget" used={costs.totalSpendInr} budget={costs.hardBudgetInr} />
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>By task</h2>
                </CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-2 max-h-80 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
                tabIndex={0}
                role="region"
                aria-label="By task"
              >
                {Object.entries(costs.byTask).length === 0 && <Empty text="No AI usage recorded this month." />}
                {Object.entries(costs.byTask)
                  .sort((a, b) => b[1] - a[1])
                  .map(([task, spend]) => (
                    <div key={task} className="flex justify-between text-sm border-b border-white/10 pb-2">
                      <span>{task}</span>
                      <span className="text-slate-300">{inr(spend)}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>By plan tier</h2>
                </CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-2 max-h-80 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
                tabIndex={0}
                role="region"
                aria-label="By plan tier"
              >
                {Object.entries(costs.byTier).length === 0 && <Empty text="No AI usage recorded this month." />}
                {Object.entries(costs.byTier)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tier, spend]) => (
                    <div key={tier || 'unknown'} className="flex justify-between text-sm border-b border-white/10 pb-2">
                      <span>{tier || 'Unknown'}</span>
                      <span className="text-slate-300">{inr(spend)}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10 xl:col-span-2">
              <CardHeader>
                <CardTitle>
                  <h2>Top accounts by spend</h2>
                </CardTitle>
              </CardHeader>
              <CardContent
                className="space-y-2 max-h-96 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
                tabIndex={0}
                role="region"
                aria-label="Top accounts by spend"
              >
                {costs.topAccounts.length === 0 && <Empty text="No AI usage recorded this month." />}
                {costs.topAccounts.map((a) => (
                  <div
                    key={`${a.accountType}:${a.accountId}`}
                    className="flex justify-between text-sm border-b border-white/10 pb-2"
                  >
                    <span className="font-mono text-xs">
                      {a.accountType}:{a.accountId}
                    </span>
                    <span className="text-slate-300">{inr(a.spendInr)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </Panel>
    </div>
  );
}
