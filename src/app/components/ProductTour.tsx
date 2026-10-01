import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Search,
  Briefcase,
  Music,
  Users,
  CalendarDays,
  Zap,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import type { LucideIcon } from 'lucide-react';

type Role = 'jobseeker' | 'employer' | 'public';
type TourStep = { icon?: LucideIcon; title: string; text: string; to?: string; cta?: string };
const tours: { [k: string]: TourStep[] } = {
  public: [
    {
      icon: Compass,
      title: 'Start with your goal',
      text: 'Verse is organized around what you came to do: find work, hire someone, book live music, or solve an urgent crew gap.',
      to: '/start',
      cta: 'Show me the shortcuts',
    },
    {
      icon: Search,
      title: 'Search the whole music network',
      text: 'Search jobs, professionals, acts and work samples from one place—even if you only know a rough term like “sound person” or “Bollywood guitarist”.',
      to: '/search',
      cta: 'Try global search',
    },
    {
      icon: ShieldCheck,
      title: 'Look for proof and trust signals',
      text: 'Compare credits, tagged work samples, verification, availability, rates and completed-work signals instead of relying on a generic bio.',
      to: '/guide',
      cta: 'Read the 5-minute guide',
    },
  ],
  jobseeker: [
    {
      icon: Music,
      title: 'Build proof before applying',
      text: 'Add several work samples and tag each by genre, role, instrument and skill. Employers can then find the right proof instead of opening one generic reel.',
      to: '/jobseeker/library',
      cta: 'Add your work',
    },
    {
      icon: Briefcase,
      title: 'Find work your way',
      text: 'Explore jobs, gigs, auditions, sessions, tours and collaborations. Save promising work and keep your application stages in one place.',
      to: '/jobseeker/jobs',
      cta: 'Explore opportunities',
    },
    {
      icon: CalendarDays,
      title: 'Publish availability',
      text: 'Mark when you are available, on hold or booked. This helps urgent and date-specific hiring work much better.',
      to: '/jobseeker/availability',
      cta: 'Set availability',
    },
    {
      icon: Users,
      title: 'You can hire too',
      text: 'If you know the exact seat, use Band Builder. If you only know the show or event, Build My Crew will recommend the people you may need before you publish openings.',
      to: '/jobseeker/build-my-crew',
      cta: 'Build my crew',
    },
    {
      icon: Zap,
      title: 'Handle last-minute cancellations',
      text: 'Urgent Replacement is for “I need a drummer/FOH/keyboardist tomorrow” situations—not for normal long-term recruitment.',
      to: '/jobseeker/urgent',
      cta: 'See urgent requests',
    },
  ],
  employer: [
    {
      icon: Search,
      title: 'Search by music-specific signals',
      text: 'Look beyond job titles: role, instrument, genre, gear, DAW, sight-reading, travel readiness, rates and recent activity help narrow real-world fit.',
      to: '/employer/candidates',
      cta: 'Search talent',
    },
    {
      icon: Briefcase,
      title: 'Use the right hiring format',
      text: 'Create a job, gig, audition, session, tour, internship or collaboration. Clear timing, pay and screening questions improve applicant quality.',
      to: '/employer/post-job',
      cta: 'Create opportunity',
    },
    {
      icon: Users,
      title: 'Compare and organize talent',
      text: 'Select 2–4 professionals to compare rates, proof, skills and availability side by side. Save strong people into reusable folders for future projects.',
      to: '/employer/candidates',
      cta: 'Search & compare',
    },
    {
      icon: Users,
      title: 'Not sure which crew roles you need?',
      text: 'Describe the event, audience size and production needs. Build My Crew creates a practical starting lineup that can be converted into hireable seats.',
      to: '/employer/build-my-crew',
      cta: 'Build my crew',
    },
    {
      icon: CalendarDays,
      title: 'Book acts separately from hiring',
      text: 'Booking an existing act is a quote/availability/payment journey. Recruiting a musician is an application journey; Verse keeps them separate.',
      to: '/employer/book-talent',
      cta: 'Book talent',
    },
    {
      icon: Zap,
      title: 'Use urgent hiring only when it is urgent',
      text: 'For a cancellation or immediate gap, publish an urgent replacement request and collect available responses quickly.',
      to: '/employer/urgent',
      cta: 'Create urgent request',
    },
  ],
};
/**
 * The full product tour modal. It never opens by itself: it is only shown when someone asks for
 * it ("Take product tour"). First-visit guidance is the inline {@link TourStrip} instead.
 */
export function ProductTour({
  role = 'public',
  forceOpen = false,
  onClose,
}: {
  role?: Role;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const key = `verse-tour-v2-${role}`,
    steps = useMemo(() => tours[role] || tours.public, [role]);
  const [open, setOpen] = useState(false),
    [i, setI] = useState(0);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const close = () => {
    try {
      localStorage.setItem(key, 'done');
    } catch {}
    setOpen(false);
    onClose?.();
  };
  const s = steps[i],
    Icon = s.icon || HelpCircle;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Radix calls this for Escape and a backdrop click too, so both now close the
        // tour like every other dialog in the app (CRAWL-03).
        if (!next) close();
      }}
    >
      <DialogContent
        className="w-full max-w-lg rounded-2xl border-white/15 bg-slate-950 p-0 text-white shadow-2xl overflow-hidden sm:max-w-lg"
        aria-label="Verse product tour"
      >
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-violet-500 transition-all"
            style={{ width: `${((i + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="p-6">
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 grid place-items-center">
            <Icon className="text-violet-300" />
          </div>
          <div className="text-xs uppercase tracking-[.18em] text-slate-500 mt-5">
            Step {i + 1} of {steps.length}
          </div>
          <DialogTitle className="text-2xl font-bold text-white mt-2">{s.title}</DialogTitle>
          <p className="text-slate-300 leading-7 mt-3">{s.text}</p>
          <div className="flex flex-wrap gap-2 mt-6">
            {s.to && (
              <Button asChild>
                <Link to={s.to} onClick={close}>
                  {s.cta || 'Go there'}
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/guide" onClick={close}>
                Full guide
              </Link>
            </Button>
          </div>
          <div className="flex justify-between mt-7 pt-5 border-t border-white/10">
            <Button variant="ghost" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>
              <ChevronLeft size={16} className="mr-1" />
              Back
            </Button>
            {i < steps.length - 1 ? (
              <Button variant="secondary" onClick={() => setI(i + 1)}>
                Next
                <ChevronRight size={16} className="ml-1" />
              </Button>
            ) : (
              <Button onClick={close}>Finish tour</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TourLauncher({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-2"
        >
          <HelpCircle size={15} />
          Take product tour
        </button>
      }
      {open && <ProductTour role={role} forceOpen onClose={() => setOpen(false)} />}
    </>
  );
}

type StripCard = { key: string; icon: LucideIcon; title: string; text: string; to: string };
const strips: { [k in 'jobseeker' | 'employer']: StripCard[] } = {
  jobseeker: [
    { key: 'sample', icon: Music, title: 'Add your work', text: 'Get found faster.', to: '/jobseeker/library' },
    { key: 'applied', icon: Briefcase, title: 'Find work', text: 'Gigs, sessions, auditions.', to: '/jobseeker/jobs' },
    {
      key: 'availability',
      icon: CalendarDays,
      title: 'Set availability',
      text: 'Show when you are free.',
      to: '/jobseeker/availability',
    },
  ],
  employer: [
    {
      key: 'post',
      icon: Briefcase,
      title: 'Post an opportunity',
      text: 'Describe work and pay.',
      to: '/employer/post-job',
    },
    {
      key: 'talent',
      icon: Search,
      title: 'Find talent',
      text: 'Search by skill and city.',
      to: '/employer/candidates',
    },
    { key: 'urgent', icon: Zap, title: 'Need someone fast?', text: 'Send an urgent request.', to: '/employer/urgent' },
  ],
};
const stripKey = (role: string) => `verse-tour-strip-v1-${role}`;

/**
 * A dismissible three-card strip for the top of a dashboard. It replaces the old auto-opening
 * modal: nothing blocks the page, "Got it" hides it for good (remembered in localStorage), and it
 * never renders on small screens.
 */
export function TourStrip({
  role,
  done,
}: {
  role: 'jobseeker' | 'employer';
  /** Which cards the person has already done, by card key; a done card is ticked, and the strip goes away once all are. */
  done?: Partial<Record<string, boolean>>;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      // People who already finished or closed the old first-run tour do not need the strip either.
      return (
        localStorage.getItem(stripKey(role)) === 'done' || localStorage.getItem(`verse-tour-v2-${role}`) === 'done'
      );
    } catch {
      return false;
    }
  });
  const cards = strips[role];
  if (dismissed || (done && cards.every((card) => done[card.key]))) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(stripKey(role), 'done');
    } catch {}
    setDismissed(true);
  };
  return (
    <section aria-label="Getting started" data-testid="tour-strip" className="mb-5 hidden items-stretch gap-3 md:flex">
      {cards.map((c) => {
        const complete = Boolean(done?.[c.key]);
        return (
          <Link
            key={c.key}
            to={c.to}
            data-done={complete || undefined}
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/[.04] p-3 hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
              complete ? 'opacity-70' : ''
            }`}
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                complete ? 'bg-emerald-500/15 text-emerald-300' : 'bg-violet-500/15 text-violet-200'
              }`}
            >
              {complete ? <Check aria-hidden="true" size={18} /> : <c.icon aria-hidden="true" size={18} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">
                {c.title}
                {complete && <span className="sr-only"> (done)</span>}
              </span>
              <span className="block text-xs text-slate-400">{complete ? 'Done' : c.text}</span>
            </span>
          </Link>
        );
      })}
      <Button variant="ghost" size="sm" className="self-center" onClick={dismiss}>
        Got it
      </Button>
    </section>
  );
}
