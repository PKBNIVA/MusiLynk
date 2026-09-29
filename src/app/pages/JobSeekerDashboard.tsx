import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { TourStrip } from '../components/ProductTour';
import { HelpCallout } from '../components/help/HelpCallout';
import { WelcomeNextStep } from '../components/landing/WelcomeNextStep';
import { HELP } from '../components/help/helpContent';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { Link, useLocation } from 'react-router';
import { Search, ArrowRight, MapPin, Sparkles, Siren } from 'lucide-react';
import { VouchCard } from '../components/VouchCard';
import { optionLabel } from '../components/ui/option-labels';
import type { Job, JobSeekerDashboard } from '../lib/apiTypes';
const plural = (n: number | undefined, word: string) => `${n || 0} ${word}${n === 1 ? '' : 's'}`;
export default function JobSeekerDashboard() {
  const { user } = useAuth();
  const welcome = new URLSearchParams(useLocation().search).get('welcome') === '1';
  const [d, setD] = useState<Partial<JobSeekerDashboard> & { recommendedJobs: Job[] }>({ recommendedJobs: [] }),
    [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = () => {
    setState('loading');
    apiGet<JobSeekerDashboard>('/dashboard')
      .then((x) => {
        setD({ ...x, recommendedJobs: x?.recommendedJobs || [] });
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, []);
  const goodFits = d.recommendedJobs.filter((j) => (j.fitScore ?? 0) >= 60);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <PageHeader
          title={`Hi, ${user?.name?.split(' ')[0] || 'there'}`}
          actions={
            <Button asChild>
              <Link to="/jobseeker/jobs">
                <Search size={16} className="mr-2" />
                Explore opportunities
              </Link>
            </Button>
          }
        />
        {!welcome && <TourStrip role="jobseeker" />}
        <WelcomeNextStep role="jobseeker" />
        <HelpCallout {...HELP.jobseekerDashboard} />
        {state === 'error' && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm flex flex-wrap items-center justify-between gap-3"
          >
            <span>Your dashboard could not be loaded, so the numbers below may be out of date.</span>
            <Button size="sm" variant="outline" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {Boolean(d.urgentNearby?.count) && (
          <Card className="bg-gradient-to-br from-orange-500/15 to-rose-500/[.06] border-orange-400/20 mb-8">
            <CardContent className="p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-orange-500/15 p-2.5 shrink-0">
                  <Siren aria-hidden="true" size={20} className="text-orange-300" />
                </div>
                <div>
                  <h2 className="font-semibold flex items-center gap-2">
                    Urgent near you
                    <Badge className="bg-orange-500/20 text-orange-200">{d.urgentNearby?.count}</Badge>
                  </h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {d.urgentNearby?.items
                      .slice(0, 2)
                      .map((r) => `${r.roleName} in ${r.city}`)
                      .join(' · ')}
                    {(d.urgentNearby?.count || 0) > 2 ? ' and more' : ''}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="shrink-0">
                <Link to="/jobseeker/urgent">
                  Respond now <ArrowRight size={14} className="ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {state === 'ready' && (d.profileScore ?? 0) < 80 && (
          <div
            data-testid="profile-nudge"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm"
          >
            <span>
              Profile {d.profileScore || 0}% complete{' '}
              <span className="text-slate-400">· Finish it so hirers can find you</span>
            </span>
            <Link to="/jobseeker/profile" className="inline-flex items-center text-violet-300 hover:text-violet-200">
              Finish profile <ArrowRight aria-hidden="true" size={14} className="ml-1" />
            </Link>
          </div>
        )}
        {user?.verified && (
          <div className="mb-10">
            <VouchCard />
          </div>
        )}
        {goodFits.length > 0 && (
          <section aria-labelledby="best-fits" className="mb-8">
            <h2 id="best-fits" className="mb-4 flex items-center gap-2 text-2xl font-semibold">
              <Sparkles aria-hidden="true" size={24} className="text-violet-300" />
              Best current fits
            </h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {goodFits.map((j) => (
                <Link key={j.id} to={`/jobseeker/jobs/${j.id}`}>
                  <Card className="verse-lift h-full bg-white/[.055] border-white/10 hover:bg-white/[.075]">
                    <CardContent className="p-5">
                      <div className="flex justify-between gap-3">
                        <Badge variant="secondary">{optionLabel(j.opportunity_kind || 'job')}</Badge>
                        <Badge className="bg-emerald-500/10 text-emerald-200">Good fit</Badge>
                      </div>
                      <h3 className="font-semibold text-lg mt-4">{j.title}</h3>
                      <p className="text-violet-300 text-sm mt-1">{j.company}</p>
                      <p className="text-sm text-slate-400 mt-3 flex items-center gap-1.5">
                        <MapPin aria-hidden="true" size={16} />
                        {[j.location, j.workplace && optionLabel(j.workplace)].filter(Boolean).join(' · ')}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
        {state === 'ready' && (
          <p className="flex flex-wrap gap-2 text-sm" data-testid="dashboard-stats">
            {[plural(d.applications, 'application'), plural(d.interviews, 'interview'), `${d.saved || 0} saved`].map(
              (t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-slate-300">
                  {t}
                </span>
              ),
            )}
          </p>
        )}
      </main>
    </div>
  );
}
