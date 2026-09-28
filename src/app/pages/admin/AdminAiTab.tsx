import { useEffect, useState } from 'react';
import { Sparkles, Gift } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Progress } from '../../components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { errorMessage } from '../../lib/errors';
import { Panel, Empty } from './shared';
import { AdminPageHeader, AdminSelect, HowToCallout, InfoTip } from './ui';

// GET /api/admin/ai/costs (Admin::AiController#costs) — see backend/docs/ai-assist.md.
type AiCosts = {
  totalSpendInr: number;
  freeTierSpendInr: number;
  freeTierBudgetInr: number;
  hardBudgetInr: number;
  byTask: Record<string, number>;
  byTier: Record<string, number>;
  topAccounts: { accountType: string; accountId: string; spendInr: number }[];
};

const ACCOUNT_TYPES = [
  { value: 'user', label: 'User' },
  { value: 'organization', label: 'Organization' },
] as const;

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
      <Progress value={pct} className={pct >= 90 ? '[&_[data-slot=progress-indicator]]:bg-rose-500' : undefined} />
    </div>
  );
}

export default function AdminAiTab() {
  const [costs, setCosts] = useState<AiCosts | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ accountType: 'user', accountId: '', credits: '', note: '' });
  const [confirmingGrant, setConfirmingGrant] = useState(false);
  const [granting, setGranting] = useState(false);

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

  const creditsValid = /^\d+$/.test(grantForm.credits) && Number(grantForm.credits) > 0;

  async function submitGrant() {
    if (!creditsValid || granting) return;
    setGranting(true);
    try {
      const d = await apiPost<{ ok: boolean; balance: number }>('/admin/ai/grants', {
        accountType: grantForm.accountType,
        accountId: grantForm.accountId.trim(),
        credits: Number(grantForm.credits),
        note: grantForm.note.trim() || undefined,
      });
      toast.success(`Granted ${grantForm.credits} credits. New balance: ${d.balance}.`);
      setGrantOpen(false);
      setConfirmingGrant(false);
      setGrantForm({ accountType: 'user', accountId: '', credits: '', note: '' });
      load();
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not grant credits.'));
    } finally {
      setGranting(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        icon={Sparkles}
        title="AI"
        description="This month's Verse AI spend, budget guardrails and manual credit grants."
      />
      <HowToCallout storageKey="ai">
        Spend is estimated from reported token usage and resets on the 1st (UTC). The <b>free-tier</b> and <b>hard</b>{' '}
        bars are the guardrails that pause free usage, and then everyone, once crossed.{' '}
        <InfoTip
          label="Grant credits"
          text="Adds credits to an account's ledger immediately, at no charge. Every grant is audited."
        />{' '}
        Use <b>Grant credits</b> for support cases or goodwill credit.
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
              <CardContent className="space-y-2 max-h-80 overflow-auto">
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
              <CardContent className="space-y-2 max-h-80 overflow-auto">
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
                <CardTitle className="flex items-center justify-between gap-3">
                  <h2>Top accounts by spend</h2>
                  <Button size="sm" onClick={() => setGrantOpen(true)}>
                    <Gift aria-hidden="true" size={14} className="mr-2" />
                    Grant credits
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-96 overflow-auto">
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

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="bg-slate-950 border-white/15 text-white">
          <DialogHeader>
            <DialogTitle>Grant AI credits</DialogTitle>
            <DialogDescription className="text-slate-400">
              Adds credits to an account's balance immediately, at no charge. Recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="ai-grant-account-type">Account type</Label>
                <AdminSelect
                  id="ai-grant-account-type"
                  value={grantForm.accountType}
                  onChange={(v) => setGrantForm((f) => ({ ...f, accountType: v }))}
                  options={ACCOUNT_TYPES}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ai-grant-credits">Credits</Label>
                <Input
                  id="ai-grant-credits"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={grantForm.credits}
                  onChange={(e) => setGrantForm((f) => ({ ...f, credits: e.target.value }))}
                  aria-invalid={!creditsValid && grantForm.credits !== ''}
                  className="bg-white/5 border-white/15"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-grant-account-id">Account id</Label>
              <Input
                id="ai-grant-account-id"
                value={grantForm.accountId}
                onChange={(e) => setGrantForm((f) => ({ ...f, accountId: e.target.value }))}
                placeholder="user_… or orga_…"
                className="bg-white/5 border-white/15 font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-grant-note">Reason</Label>
              <Textarea
                id="ai-grant-note"
                value={grantForm.note}
                onChange={(e) => setGrantForm((f) => ({ ...f, note: e.target.value }))}
                maxLength={500}
                className="bg-white/5 border-white/15 min-h-20"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!creditsValid || !grantForm.accountId.trim()}
              onClick={() => setConfirmingGrant(true)}
            >
              Grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingGrant} onOpenChange={setConfirmingGrant}>
        <DialogContent className="bg-slate-950 border-white/15 text-white">
          <DialogHeader>
            <DialogTitle>Confirm grant</DialogTitle>
            <DialogDescription className="text-slate-400">
              Grant {grantForm.credits} AI credits to {grantForm.accountType}:{grantForm.accountId}? This takes effect
              immediately and cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmingGrant(false)} disabled={granting}>
              Back
            </Button>
            <Button type="button" onClick={submitGrant} disabled={granting} aria-busy={granting}>
              {granting ? 'Granting…' : 'Confirm grant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
