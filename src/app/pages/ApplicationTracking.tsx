import { EmptyState as SceneEmptyState } from '../components/kit/EmptyState';
import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { HelpCallout } from '../components/help/HelpCallout';
import { HELP } from '../components/help/helpContent';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { apiDelete, apiGet } from '../lib/api';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { useConfirm } from '../components/booking/BookingDialogs';
import { MapPin, Calendar, BriefcaseBusiness } from 'lucide-react';
import { errorMessage } from '../lib/errors';
import type { Application } from '../lib/apiTypes';
import { formatDate, formatDateTime } from '../lib/format';
import { optionLabel } from '../components/ui/option-labels';
const ordered = ['Applied', 'Under Review', 'Shortlisted', 'Interview Scheduled', 'Offer', 'Hired'];
export default function ApplicationTracking() {
  const [apps, setApps] = useState<Application[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    confirm = useConfirm();
  const load = () => {
    setError('');
    return apiGet<{ applications?: Application[] }>('/applications')
      .then((d) => setApps(d.applications || []))
      .catch((e: unknown) => setError(errorMessage(e, 'Applications could not be loaded.')))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  function withdraw(id: string, title: string) {
    confirm.ask({
      title: `Withdraw your application for “${title}”?`,
      description: 'The hirer will no longer see it.',
      confirmLabel: 'Withdraw',
      destructive: true,
      action: async () => {
        await apiDelete(`/applications/${id}`);
        toast.success('Application withdrawn');
        load();
      },
    });
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <PageHeader title="Applications" help={<HelpCallout {...HELP.applications} />} />
        {error ? (
          <Card className="bg-rose-500/10 border-rose-400/20" role="alert">
            <CardContent className="p-6">
              <p>{error}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  load();
                }}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-slate-400">Loading applications…</p>
        ) : apps.length === 0 ? (
          <SceneEmptyState
            scene="inbox"
            title="No applications yet"
            hint="Find a gig, session or role and apply in minutes."
            action={{ label: 'Find work', to: '/jobseeker/jobs' }}
          />
        ) : (
          <div className="space-y-4">
            {apps.map((a) => (
              <Card key={a.id} className="bg-white/[.055] border-white/10">
                <CardContent className="p-5 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{optionLabel(a.opportunityKind || 'job')}</Badge>
                        <h2 className="text-xl font-semibold">
                          <Link to={`/jobseeker/jobs/${a.jobId || a.job_id}`} className="hover:text-violet-200">
                            {a.title}
                          </Link>
                        </h2>
                        <Badge>{a.status}</Badge>
                      </div>
                      <p className="text-violet-300 mt-1">{a.company}</p>
                      <div className="text-sm text-slate-400 flex flex-wrap gap-4 mt-3">
                        <span className="flex items-center">
                          <MapPin size={15} className="mr-1" />
                          {a.location}
                        </span>
                        <span className="flex items-center">
                          <BriefcaseBusiness size={15} className="mr-1" />
                          {optionLabel(a.workplace)}
                        </span>
                        <span>Applied {formatDate(a.createdAt)}</span>
                        {a.interviewDate && (
                          <span className="flex text-emerald-300">
                            <Calendar size={15} className="mr-1" />
                            {formatDateTime(a.interviewDate)}
                          </span>
                        )}
                      </div>
                    </div>
                    {['Applied', 'Under Review'].includes(a.status) && (
                      <Button size="sm" variant="outline" onClick={() => withdraw(a.id, a.title)}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                  {a.status === 'Offer' && (
                    <p className="mt-4 text-sm text-emerald-200">
                      You have an offer. Confirm terms with the hirer in{' '}
                      <Link to="/jobseeker/messages" className="underline">
                        Messages
                      </Link>
                      ; they mark the hire when it is agreed.
                    </p>
                  )}
                  {a.status !== 'Rejected' && (
                    <div className="mt-6 grid grid-cols-6 gap-1">
                      {ordered.map((s, i) => {
                        const current = ordered.indexOf(a.status),
                          done = i <= current;
                        return (
                          <div key={s}>
                            <div className={`h-1.5 rounded-full ${done ? 'bg-violet-500' : 'bg-white/10'}`} />
                            <div className="text-[10px] text-slate-600 mt-1 hidden sm:block truncate">{s}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      {confirm.element}
    </div>
  );
}
