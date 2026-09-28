import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { HelpCallout } from '../components/help/HelpCallout';
import { WelcomeNextStep } from '../components/landing/WelcomeNextStep';
import { HELP } from '../components/help/helpContent';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { Link, useLocation } from 'react-router';
import {
  Briefcase,
  Calendar,
  Search,
  Bookmark,
  ArrowRight,
  ShieldCheck,
  Bell,
  Gauge,
  MapPin,
  Sparkles,
  Siren,
} from 'lucide-react';
import { EmptyState } from '../components/help/EmptyState';
import { optionLabel } from '../components/ui/option-labels';
import type { Job, JobSeekerDashboard } from '../lib/apiTypes';
import type { LucideIcon } from 'lucide-react';
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
  const Stat = ({ n, label, icon: I }: { n?: number; label: string; icon: LucideIcon }) => (
    <Card className="bg-white/[.055] border-white/10">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="rounded-xl bg-violet-500/10 p-3">
          <I className="text-violet-300" />
        </div>
        <div>
          <div className="text-2xl font-bold">{n || 0}</div>
          <div className="text-sm text-slate-400">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <div className="flex flex-col md:flex-row justify-between gap-5 mb-7">
          <div>
            <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Career workspace</div>
            <h1 className="text-4xl md:text-5xl font-bold">
              {/* Right after the two-minute sign-up (?welcome=1) it is a first visit, not a return. */}
              {welcome ? 'Welcome' : 'Welcome back'}, {user?.name?.split(' ')[0]}
            </h1>
            <p className="text-slate-400 mt-2">
              Focus on credible opportunities and proof of work, not application volume.
            </p>
          </div>
          <Button asChild>
            <Link to="/jobseeker/jobs">
              <Search size={16} className="mr-2" />
              Explore opportunities
            </Link>
          </Button>
        </div>
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
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <Stat n={d.applications} label="Applications" icon={Briefcase} />
          <Stat n={d.interviews} label="Interviews" icon={Calendar} />
          <Stat n={d.saved} label="Saved opportunities" icon={Bookmark} />
        </div>
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
        <Card className="bg-gradient-to-br from-violet-500/10 to-sky-500/[.06] border-white/10 mb-10">
          <CardContent className="p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <Gauge aria-hidden="true" size={20} className="text-violet-300" />
                    Career profile strength
                  </h2>
                  {user?.verified && (
                    <Badge className="bg-emerald-500/15 text-emerald-300">
                      <ShieldCheck size={13} className="mr-1" />
                      Verified
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Credits, portfolio proof, skills, genres and availability are stronger hiring signals than a generic
                  bio.
                </p>
              </div>
              <div className="w-full md:w-64">
                <div className="flex justify-between text-sm mb-2">
                  <span>Completeness</span>
                  <span>{d.profileScore || 0}%</span>
                </div>
                <Progress value={d.profileScore || 0} aria-label={`Profile completeness, ${d.profileScore || 0}%`} />
                <Link to="/jobseeker/profile" className="text-xs text-violet-300 mt-2 inline-flex items-center">
                  Improve profile <ArrowRight size={12} className="ml-1" />
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Sparkles aria-hidden="true" size={24} className="text-violet-300" />
              Best current fits
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Transparent profile-fit score based on skills, genre, location and work mode—not a black-box AI verdict.
            </p>
          </div>
        </div>
        {state === 'ready' && !d.recommendedJobs?.length && (
          <EmptyState
            icon={Bell}
            title="No open opportunities to recommend right now."
            action={
              <Button asChild variant="outline">
                <Link to="/jobseeker/alerts">
                  <Bell aria-hidden="true" size={16} className="mr-2" />
                  Set up an alert
                </Link>
              </Button>
            }
          >
            New gigs and sessions arrive every week. An alert tells you as soon as one fits.
          </EmptyState>
        )}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {d.recommendedJobs?.map((j) => (
            <Link key={j.id} to={`/jobseeker/jobs/${j.id}`}>
              <Card className="verse-lift h-full bg-white/[.055] border-white/10 hover:bg-white/[.075]">
                <CardContent className="p-5">
                  <div className="flex justify-between gap-3">
                    <Badge variant="secondary">{optionLabel(j.opportunity_kind || 'job')}</Badge>
                    <Badge className="bg-sky-500/15 text-sky-200">{j.fitScore}% fit</Badge>
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
      </main>
    </div>
  );
}
