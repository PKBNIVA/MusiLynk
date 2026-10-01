import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { TourStrip } from '../components/ProductTour';
import { HelpCallout } from '../components/help/HelpCallout';
import { WelcomeNextStep } from '../components/landing/WelcomeNextStep';
import { HELP } from '../components/help/helpContent';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { apiGet } from '../lib/api';
import { Link, useLocation } from 'react-router';
import { Plus, ShieldCheck, Zap } from 'lucide-react';
import { UserAvatar } from '../components/kit/UserAvatar';
import { FormatGlyph } from '../components/kit/FormatGlyph';
import { EmptyState } from '../components/kit/EmptyState';
import { StatChips } from '../components/kit/StatChips';
import { useAuth } from '../lib/authContext';
import { OpportunityPipeline } from '../components/OpportunityPipeline';
import type { EmployerApplication, EmployerDashboard } from '../lib/apiTypes';
const plural = (n: number | undefined, one: string, many = `${one}s`) => (n === 1 ? one : many);
export default function EmployerDashboard() {
  const [d, setD] = useState<Partial<EmployerDashboard>>({}),
    [loaded, setLoaded] = useState(false),
    { user } = useAuth(),
    location = useLocation();
  const load = () =>
    apiGet<EmployerDashboard>('/dashboard')
      .then((next) => {
        setD(next);
        setLoaded(true);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  // Nothing posted yet: the two choice cards are the one way in, so no other button or strip repeats them.
  const welcome = new URLSearchParams(location.search).has('welcome');
  const empty = loaded && !d.jobs;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <PageHeader
          help={<HelpCallout {...HELP.employerDashboard} />}
          title={`Hi, ${user?.name?.split(' ')[0] || 'there'}`}
          actions={
            <>
              {user?.verified && (
                <Badge className="bg-emerald-500/15 text-emerald-300">
                  <ShieldCheck size={13} className="mr-1" />
                  Verified
                </Badge>
              )}
              {!empty && (
                <Button asChild variant={d.applications ? 'outline' : 'default'}>
                  <Link to="/employer/post-job">
                    <Plus size={16} className="mr-2" />
                    Post an opportunity
                  </Link>
                </Button>
              )}
            </>
          }
        />
        {!welcome && !empty && <TourStrip role="employer" />}
        <WelcomeNextStep role="employer" />
        <NewApplicants count={d.applications || 0} hasLive={(d.published || 0) > 0} />
        {!(empty && welcome) && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 mt-8">
              <h2 className="text-xl font-semibold flex items-center gap-2">Live opportunities</h2>
              <Link to="/employer/candidates" className="text-sm text-violet-300">
                Search talent
              </Link>
            </div>
            <OpportunityPipeline role="employer" onChanged={load} emptySlot={<ChoiceCards />} />
          </>
        )}
        <StatChips
          className="mt-8"
          items={[
            { label: plural(d.jobs, 'opportunity', 'opportunities'), value: d.jobs || 0 },
            { label: 'live', value: d.published || 0 },
            { label: plural(d.applications, 'application'), value: d.applications || 0 },
            { label: 'shortlisted', value: d.shortlisted || 0 },
          ]}
        />
      </main>
    </div>
  );
}

/** Who applied lately: up to five avatars with names, one line of counts and a Review button. */
function NewApplicants({ count, hasLive }: { count: number; hasLive: boolean }) {
  const [apps, setApps] = useState<EmployerApplication[]>([]);
  useEffect(() => {
    if (!count) return;
    apiGet<{ applications?: EmployerApplication[] }>('/employer/applications')
      .then((d) => setApps(d.applications || []))
      .catch(() => {});
  }, [count]);
  if (!count) {
    return hasLive ? (
      <EmptyState
        scene="applicants"
        title="No applicants yet"
        hint="Most opportunities get their first applicant within 48 hours"
      />
    ) : null;
  }
  const people = [...new Map(apps.map((a) => [a.candidateId, a])).values()].slice(0, 5);
  const opportunities = new Set(apps.map((a) => a.jobId)).size;
  return (
    <section aria-labelledby="new-applicants" className="rounded-2xl border border-white/10 bg-white/[.04] p-5">
      <h2 id="new-applicants" className="text-xl font-semibold">
        New applicants
      </h2>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
        {people.map((a) => (
          <li key={a.candidateId} className="flex items-center gap-2">
            <UserAvatar id={a.candidateId} name={a.candidateName} size="md" />
            <span className="text-sm font-medium">{a.candidateName}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">
          {count} applicant{count === 1 ? '' : 's'}
          {opportunities ? ` across ${opportunities} ${opportunities === 1 ? 'opportunity' : 'opportunities'}` : ''}
        </p>
        <Button asChild>
          <Link to="/employer/applications">Review</Link>
        </Button>
      </div>
    </section>
  );
}

/** No opportunities yet: two big ways to start. */
function ChoiceCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="dashboard-choices">
      <Link
        to="/employer/post-job"
        className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[.04] p-8 text-center hover:bg-white/[.07]"
      >
        <FormatGlyph kind="job" size={24} className="size-10 text-violet-300" />
        <span className="mt-4 text-lg font-semibold">Post an opportunity</span>
      </Link>
      <Link
        to="/employer/urgent"
        className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[.04] p-8 text-center hover:bg-white/[.07]"
      >
        <Zap aria-hidden="true" className="size-10 text-amber-300" />
        <span className="mt-4 text-lg font-semibold">Need someone by tomorrow?</span>
      </Link>
    </div>
  );
}
