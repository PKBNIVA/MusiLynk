import { useEffect, useState } from 'react';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { TourStrip } from '../components/ProductTour';
import { HelpCallout } from '../components/help/HelpCallout';
import { WelcomeNextStep } from '../components/landing/WelcomeNextStep';
import { HELP } from '../components/help/helpContent';
import { Button } from '../components/ui/button';
import { JobCard } from '../components/JobCard';
import { EmptyState } from '../components/kit/EmptyState';
import { StatChips, plural } from '../components/kit/StatChips';
import { formatWhen } from '../lib/format';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { Link, useLocation } from 'react-router';
import { Search, ArrowRight, Sparkles, Zap, MessageSquare, CalendarCheck } from 'lucide-react';
import { VouchCard } from '../components/VouchCard';
import type { Conversation, Job, JobSeekerDashboard } from '../lib/apiTypes';
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
  const [convs, setConvs] = useState<Conversation[]>([]);
  useEffect(() => {
    // Unread messages are a nicety: a failed fetch simply hides that tile.
    apiGet<{ conversations?: Conversation[] }>('/conversations')
      .then((x) => setConvs(x?.conversations || []))
      .catch(() => undefined);
  }, []);
  const goodFits = d.recommendedJobs.filter((j) => (j.fitScore ?? 0) >= 60).slice(0, 3);
  const unread = convs.reduce((n, c) => n + (c.unreadCount || 0), 0);
  const latestUnread = convs
    .filter((c) => (c.unreadCount || 0) > 0)
    .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || '')))[0];
  const urgent = d.urgentNearby;
  const first = urgent?.items?.[0];
  const tiles = [
    urgent?.count
      ? {
          key: 'urgent',
          urgent: true,
          Icon: Zap,
          title: `${urgent.count} urgent request${urgent.count === 1 ? '' : 's'} near you`,
          line: first ? [first.roleName, first.city, formatWhen(first.startAt)].filter(Boolean).join(' · ') : '',
          cta: 'Respond',
          to: '/jobseeker/urgent',
        }
      : null,
    unread > 0
      ? {
          key: 'messages',
          urgent: false,
          Icon: MessageSquare,
          title: `${unread} unread message${unread === 1 ? '' : 's'}`,
          line: latestUnread?.counterpartName || latestUnread?.employerName || '',
          cta: 'Open',
          to: '/jobseeker/messages',
        }
      : null,
    d.interviews
      ? {
          key: 'interviews',
          urgent: false,
          Icon: CalendarCheck,
          title: `${d.interviews} interview${d.interviews === 1 ? '' : 's'} scheduled`,
          line: '',
          cta: 'See applications',
          to: '/jobseeker/applications',
        }
      : null,
  ].filter((t): t is NonNullable<typeof t> => Boolean(t));
  const isEmpty = tiles.length === 0 && goodFits.length === 0;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-7xl mx-auto px-5 md:px-6 pt-28 pb-16">
        <PageHeader
          help={<HelpCallout {...HELP.jobseekerDashboard} />}
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
        {tiles.length > 0 && (
          <section
            aria-label="Needs you now"
            className="mb-8 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3"
            data-testid="needs-you-now"
          >
            {tiles.map((t) => (
              <div
                key={t.key}
                className={`flex min-h-[96px] items-center gap-3 rounded-xl border border-white/10 bg-white/[.055] p-4 ${
                  t.urgent ? 'border-l-4 border-l-amber-400' : ''
                }`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                    t.urgent ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-slate-200'
                  }`}
                >
                  <t.Icon aria-hidden="true" size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{t.title}</h2>
                  {t.line && <p className="line-clamp-2 text-sm text-slate-400">{t.line}</p>}
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link to={t.to}>{t.cta}</Link>
                </Button>
              </div>
            ))}
          </section>
        )}
        {goodFits.length > 0 && (
          <section aria-labelledby="best-fits" className="mb-8">
            <h2 id="best-fits" className="mb-4 flex items-center gap-2 text-xl font-semibold">
              <Sparkles aria-hidden="true" size={20} className="text-violet-300" />
              Good fits
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {goodFits.map((j, i) => (
                <JobCard key={j.id} job={j} index={i} to={`/jobseeker/jobs/${j.id}`} compact />
              ))}
            </div>
          </section>
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
        {state === 'ready' && isEmpty && (
          <EmptyState
            scene="stage"
            title="Your first gig starts with your work"
            hint="Hirers hear a sample before they message."
            action={{ label: 'Add a work sample', to: '/jobseeker/library', variant: 'outline' }}
          />
        )}
        {state === 'ready' && (
          <StatChips
            items={[
              { label: plural(d.applications, 'application'), value: d.applications || 0 },
              { label: plural(d.interviews, 'interview'), value: d.interviews || 0 },
              { label: 'saved', value: d.saved || 0 },
            ]}
          />
        )}
      </main>
    </div>
  );
}
