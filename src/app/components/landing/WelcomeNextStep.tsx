import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowRight, BadgeCheck, Link2, Music, Play, PlusCircle, Search, UserRound, X, Zap } from 'lucide-react';
import { Button } from '../ui/button';
import { apiGet } from '../../lib/api';
import { useAuth } from '../../lib/authContext';

interface StarterItem {
  id: string;
  title: string;
  type?: string;
  thumbnailUrl?: string | null;
}

/**
 * The first dashboard after the two-minute sign-up (`?welcome=1`): what was set up, and the one
 * clear next step. Dismissing it drops the flag from the address.
 */
export function WelcomeNextStep({ role }: { role: 'jobseeker' | 'employer' }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const show = params.get('welcome') === '1';
  const [items, setItems] = useState<StarterItem[] | null>(null);
  useEffect(() => {
    if (!show || role !== 'jobseeker') return;
    let active = true;
    apiGet<{ items?: StarterItem[] }>('/portfolio')
      .then((data) => active && setItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [show, role]);
  if (!show) return null;

  const dismiss = () => {
    params.delete('welcome');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };
  const first = user?.name?.split(' ')[0];
  return (
    <section
      aria-labelledby="welcome-title"
      className="relative mb-8 rounded-3xl border border-violet-300/25 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-teal-400/10 p-5 md:p-7"
      data-testid="welcome-next-step"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss welcome"
        className="absolute right-3 top-3 grid size-10 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
      >
        <X aria-hidden="true" size={18} />
      </button>
      <h2 id="welcome-title" className="pr-10 text-2xl font-black md:text-3xl">
        {first ? `You’re on Verse, ${first}.` : 'You’re on Verse.'}
      </h2>
      {role === 'jobseeker' ? <MusicianWelcome items={items} /> : <HirerWelcome />}
    </section>
  );
}

function MusicianWelcome({ items }: { items: StarterItem[] | null }) {
  const count = items?.length ?? 0;
  return (
    <>
      <p className="mt-2 text-slate-300">
        {items === null
          ? 'Setting up your portfolio…'
          : count
            ? `Your starter portfolio is live with ${count} work ${count === 1 ? 'sample' : 'samples'}. Hirers can play them from your profile.`
            : 'Add a link to your work so hirers can hear you. It’s the first thing they check.'}
      </p>
      {count > 0 && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Your starter portfolio">
          {items!.slice(0, 3).map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2.5">
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  width={64}
                  height={36}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-9 w-16 shrink-0 rounded-md object-cover"
                />
              ) : (
                <span className="grid h-9 w-16 shrink-0 place-items-center rounded-md bg-white/[.06] text-teal-200">
                  {item.type === 'audio' ? (
                    <Music aria-hidden="true" size={16} />
                  ) : item.type === 'video' ? (
                    <Play aria-hidden="true" size={16} />
                  ) : (
                    <Link2 aria-hidden="true" size={16} />
                  )}
                </span>
              )}
              <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-teal-300">Next step</p>
        <p className="mt-1 font-semibold">Get your Verified badge. Hirers can filter for verified people.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild className="bg-violet-600 text-white hover:bg-violet-500">
            <Link to={count ? '/jobseeker/profile?verify=1' : '/jobseeker/portfolio'}>
              {count ? <BadgeCheck aria-hidden="true" size={16} /> : <PlusCircle aria-hidden="true" size={16} />}
              {count ? 'Request verification' : 'Add your work'}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/jobseeker/profile">
              <UserRound aria-hidden="true" size={16} />
              Complete your profile
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/jobseeker/urgent">
              <Zap aria-hidden="true" size={16} />
              See urgent requests
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}

function HirerWelcome() {
  return (
    <>
      <p className="mt-2 text-slate-300">
        Tell musicians and crew what you need. They see urgent requests as soon as you post one.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Link
          to="/employer/urgent"
          className="group rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 hover:bg-amber-400/15"
        >
          <span className="flex items-center gap-2 font-semibold text-amber-100">
            <Zap aria-hidden="true" size={18} />
            Need someone by tomorrow?
          </span>
          <span className="mt-1 block text-sm text-slate-300">Post an urgent request. Free, and takes a minute.</span>
        </Link>
        <Link
          to="/employer/post-job"
          className="group rounded-2xl border border-white/15 bg-white/[.04] p-4 hover:bg-white/[.07]"
        >
          <span className="flex items-center gap-2 font-semibold">
            <PlusCircle aria-hidden="true" size={18} className="text-violet-200" />
            Post an opportunity
          </span>
          <span className="mt-1 block text-sm text-slate-300">A session, a wedding, a tour or a regular gig.</span>
        </Link>
      </div>
      <Link
        to="/employer/candidates?verified=true"
        className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-200 underline-offset-4 hover:underline"
      >
        <Search aria-hidden="true" size={16} />
        Or browse verified musicians first
      </Link>
    </>
  );
}
