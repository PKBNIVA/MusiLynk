import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { errorMessage } from '../../lib/errors';
import { Panel, Empty } from './shared';
import { AdminPageHeader, HowToCallout } from './ui';

// GET /api/admin/funnel (Admin::FunnelController#show, backed by FunnelQueries) — see
// backend/docs/analytics.md. Self-hosted: every number here comes from product_events and the
// existing booking/urgent-request tables, cached server-side for 5 minutes.
type FunnelSummary = {
  windowDays: number;
  funnel: { step: string; count: number }[];
  weekly: { weekStart: string; bookings: number; hires: number }[];
  medianFirstResponseMinutes: number | null;
  retentionWeek1: number | null;
};

const STEP_LABELS: Record<string, string> = {
  landing_view: 'Landing view',
  path_chosen: 'Path chosen',
  signup_completed: 'Signup completed',
  first_action: 'First action (job posted or links added)',
  booking_or_urgent_filled: 'Booking or urgent request filled',
};

const WINDOWS = [7, 30] as const;

export default function FunnelTab() {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(7);
  const [data, setData] = useState<FunnelSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiGet<FunnelSummary>(`/admin/funnel?days=${days}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Unable to load the funnel.')))
      .finally(() => setLoading(false));
  };
  useEffect(load, [days]);

  const maxCount = Math.max(1, ...(data?.funnel.map((s) => s.count) || [1]));

  return (
    <div>
      <AdminPageHeader
        icon={TrendingUp}
        title="Funnel"
        description="Landing to first booking or urgent hire, self-hosted (no third-party analytics)."
      />
      <HowToCallout storageKey="funnel">
        Every number here comes from Verse's own event log, cached for 5 minutes. Nothing is sent to a third party.
      </HowToCallout>
      <div className="flex gap-2 mb-4" role="group" aria-label="Time window">
        {WINDOWS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={days === w ? 'default' : 'outline'}
            aria-pressed={days === w}
            onClick={() => setDays(w)}
          >
            Last {w} days
          </Button>
        ))}
      </div>
      <Panel error={error} onRetry={load} loading={loading}>
        {data && (
          <div className="grid xl:grid-cols-2 gap-5">
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>Funnel</h2>
                </CardTitle>
                <p className="text-sm text-slate-400">Distinct visitors reaching each step, in order.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.funnel.map((s) => (
                  <div key={s.step}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-300">{STEP_LABELS[s.step] || s.step}</span>
                      <span className="text-slate-400" data-testid={`funnel-count-${s.step}`}>
                        {s.count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-violet-500"
                        style={{ width: `${Math.max(2, Math.round((s.count / maxCount) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
                {!data.funnel.length && <Empty text="No events recorded in this window." />}
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>Weekly bookings &amp; hires</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.weekly.map((w) => (
                  <div key={w.weekStart} className="flex justify-between text-sm border-b border-white/10 pb-2">
                    <span className="text-slate-400">{new Date(w.weekStart).toLocaleDateString()}</span>
                    <span>
                      {w.bookings} bookings · {w.hires} hires
                    </span>
                  </div>
                ))}
                {!data.weekly.length && <Empty text="No bookings or hires in this window." />}
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>Median time to first response</h2>
                </CardTitle>
                <p className="text-sm text-slate-400">On urgent requests, from posting to the first reply.</p>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="median-first-response">
                  {data.medianFirstResponseMinutes == null ? '—' : `${data.medianFirstResponseMinutes} min`}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white/[.05] border-white/10">
              <CardHeader>
                <CardTitle>
                  <h2>Week 1 retention</h2>
                </CardTitle>
                <p className="text-sm text-slate-400">Signups from week 1 with any activity in week 2.</p>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" data-testid="retention-week1">
                  {data.retentionWeek1 == null ? '—' : `${data.retentionWeek1}%`}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </Panel>
    </div>
  );
}
