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
import { Plus, ShieldCheck, Workflow } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { OpportunityPipeline } from '../components/OpportunityPipeline';
import type { EmployerDashboard } from '../lib/apiTypes';
const plural = (n: number | undefined, one: string, many = `${one}s`) => `${n || 0} ${n === 1 ? one : many}`;
export default function EmployerDashboard() {
  const [d, setD] = useState<Partial<EmployerDashboard>>({}),
    { user } = useAuth(),
    location = useLocation();
  const load = () =>
    apiGet<EmployerDashboard>('/dashboard')
      .then(setD)
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
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
              <Button asChild>
                <Link to="/employer/post-job">
                  <Plus size={16} className="mr-2" />
                  Create opportunity
                </Link>
              </Button>
            </>
          }
        />
        {!new URLSearchParams(location.search).has('welcome') && <TourStrip role="employer" />}
        <WelcomeNextStep role="employer" />
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Workflow aria-hidden="true" size={24} className="text-violet-300" />
            Your opportunity pipeline
          </h2>
          <div className="flex gap-4 text-sm">
            <Link to="/employer/applications" className="text-violet-300">
              All applicants
            </Link>
            <Link to="/employer/candidates" className="text-violet-300">
              Search talent
            </Link>
          </div>
        </div>
        <OpportunityPipeline role="employer" onChanged={load} />
        <p className="mt-8 flex flex-wrap gap-2 text-sm" data-testid="dashboard-stats">
          {[
            plural(d.jobs, 'opportunity', 'opportunities'),
            `${d.published || 0} live`,
            plural(d.applications, 'application'),
            `${d.shortlisted || 0} shortlisted`,
          ].map((t) => (
            <span key={t} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-slate-300">
              {t}
            </span>
          ))}
        </p>
      </main>
    </div>
  );
}
