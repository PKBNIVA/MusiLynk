import { useEffect, useState } from 'react';
import { Bell, Pause, Play, Trash2 } from 'lucide-react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { apiDelete, apiGet, apiPatch } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { useConfirm } from '../components/booking/BookingDialogs';
import { errorMessage } from '../lib/errors';
import type { JobAlert } from '../lib/apiTypes';
import { AppSelect } from '../components/ui/app-select';

export default function JobAlerts() {
  const [alerts, setAlerts] = useState<JobAlert[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    confirm = useConfirm();
  const load = () => {
    setLoading(true);
    setError('');
    apiGet<{ alerts?: JobAlert[] }>('/job-alerts')
      .then((d) => setAlerts(d.alerts || []))
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  async function update(alert: JobAlert, changes: { active?: boolean; frequency?: string }) {
    try {
      await apiPatch(`/job-alerts/${alert.id}`, changes);
      toast.success('Alert updated');
      load();
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    }
  }
  function remove(alert: JobAlert) {
    confirm.ask({
      title: `Delete “${alert.name || 'Saved search'}”?`,
      description: 'You will stop getting notifications for this saved search.',
      confirmLabel: 'Delete',
      destructive: true,
      action: async () => {
        await apiDelete(`/job-alerts/${alert.id}`);
        toast.success('Alert deleted');
        load();
      },
    });
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-4xl mx-auto px-5 pt-28 pb-24">
        <PageHeader title="Job alerts" />
        {loading && <p className="mt-8 text-slate-400">Loading alerts…</p>}
        {error && (
          <Card className="mt-8 bg-rose-500/10 border-rose-400/20">
            <CardContent className="p-5">
              <p>{error}</p>
              <Button className="mt-3" variant="outline" onClick={load}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
        {!loading && !error && alerts.length === 0 && (
          <Card className="mt-8 bg-white/[.04] border-white/10">
            <CardContent className="p-7 text-center">
              <Bell className="mx-auto text-slate-500" />
              <h2 className="font-semibold mt-3">No job alerts yet</h2>
              <p className="text-sm text-slate-400 mt-1">Save a search from Explore work to create one.</p>
              <Button asChild className="mt-4">
                <Link to="/jobseeker/jobs">Explore work</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        <div className="space-y-4 mt-8">
          {alerts.map((a) => (
            <Card key={a.id} className="bg-white/[.055] border-white/10">
              <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-lg break-words">{a.name || 'Saved search'}</h2>
                    <Badge variant={a.active ? 'default' : 'secondary'}>{a.active ? 'Active' : 'Paused'}</Badge>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">
                    {[a.query, a.location, a.opportunity_kind, a.function_area, a.remote_only ? 'Remote only' : null]
                      .filter(Boolean)
                      .join(' · ') || 'All matching opportunities'}
                  </p>
                  <div className="mt-3 flex items-center text-xs text-slate-500">
                    <span aria-hidden="true">Delivery</span>
                    <AppSelect
                      aria-label={`Delivery frequency for ${a.name || 'Saved search'}`}
                      className="ml-2 inline-flex h-8 w-auto min-w-32 px-2 text-slate-200"
                      value={a.frequency || 'weekly'}
                      onValueChange={(v) => update(a, { frequency: v })}
                      options={[
                        { value: 'daily', description: 'One email each morning' },
                        { value: 'weekly', description: 'A Monday round-up' },
                        { value: 'saved', description: 'No emails, just keep the search' },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => update(a, { active: !a.active })}>
                    {a.active ? <Pause size={15} className="mr-1" /> : <Play size={15} className="mr-1" />}
                    {a.active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="outline" className="text-rose-300" onClick={() => remove(a)}>
                    <Trash2 size={15} className="mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      {confirm.element}
    </div>
  );
}
