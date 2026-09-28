import { Link } from 'react-router';
import { ArrowRight, BadgeCheck, BriefcaseBusiness, MapPin, Mic2, Play, Zap, type LucideIcon } from 'lucide-react';

export const LAUNCH_CITIES = ['Mumbai'] as const;

/**
 * Above the fold: the promise in one line, the city, and the two ways in. Sized so that on a
 * 390×844 phone the headline and both path buttons are visible without scrolling.
 */
export function LandingHero({ city, onCityChange }: { city: string; onCityChange: (city: string) => void }) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden px-4 pb-12 pt-6 sm:px-6 md:pb-20 md:pt-14"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(48rem_26rem_at_0%_-10%,rgba(217,70,239,.22),transparent_65%),radial-gradient(36rem_22rem_at_100%_0%,rgba(45,212,191,.13),transparent_65%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.12fr_.88fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.05] py-1 pl-3 pr-1.5 text-sm text-slate-200">
            <MapPin aria-hidden="true" size={15} className="text-teal-300" />
            <label htmlFor="landing-city">Now booking in</label>
            <select
              id="landing-city"
              value={city}
              onChange={(event) => onCityChange(event.target.value)}
              className="min-h-8 cursor-pointer rounded-full border border-white/15 bg-slate-900 px-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
            >
              {LAUNCH_CITIES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option disabled value="">
                More cities soon
              </option>
            </select>
          </div>
          <h1
            id="hero-title"
            className="mt-4 text-[2.1rem] font-black leading-[1.07] tracking-[-.035em] sm:text-5xl lg:text-[3.6rem]"
          >
            Hire a verified musician for your session or gig,{' '}
            <span className="verse-gradient-text">within 24 hours.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Singers, session players, DJs and sound crew in {city}. Hear their work, check the Verified badge, then
            book.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="hero-paths">
            <PathLink
              to="/join/hiring"
              icon={BriefcaseBusiness}
              title="I'm hiring"
              detail="Studios, weddings, events and bands"
            />
            <PathLink
              to="/join/musician"
              icon={Mic2}
              title="I'm a musician or crew"
              detail="Get booked for sessions and gigs"
            />
          </div>
          <div className="mt-5 space-y-1">
            <Link
              to="/employer/urgent"
              className="group inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-amber-200 hover:text-amber-100"
            >
              <Zap aria-hidden="true" size={17} />
              Need someone by tomorrow? Post an urgent request
              <ArrowRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="text-sm text-slate-400">Free to post. You sign in or create an account first.</p>
            <p className="pt-1 text-sm text-slate-400">
              Something else?{' '}
              <Link to="/start" className="font-medium text-slate-200 underline underline-offset-4 hover:text-white">
                See every way to use Verse
              </Link>
            </p>
          </div>
        </div>
        <ExampleProfile />
      </div>
    </section>
  );
}

function PathLink({ to, icon: Icon, title, detail }: { to: string; icon: LucideIcon; title: string; detail: string }) {
  return (
    <Link
      to={to}
      className="group flex min-h-16 items-center gap-3 rounded-2xl border border-white/15 bg-gradient-to-r from-fuchsia-700 to-violet-700 px-4 py-3 text-white shadow-lg shadow-violet-950/40 transition hover:from-fuchsia-600 hover:to-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">
        <Icon aria-hidden="true" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-6">{title}</span>
        <span className="block text-[13px] leading-5 text-fuchsia-50">{detail}</span>
      </span>
      <ArrowRight aria-hidden="true" size={18} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** What a verified portfolio looks like to a hirer. Clearly an example; desktop only. */
function ExampleProfile() {
  const samples = [
    ['Live at a sangeet, Bandra', 'YouTube'],
    ['Studio session for a Marathi single', 'SoundCloud'],
    ['Drums on a 30-second ad jingle', 'Spotify'],
  ] as const;
  return (
    <section className="relative mx-auto hidden w-full max-w-md lg:block" aria-label="Example of a verified profile">
      <div className="verse-surface rounded-3xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-lg font-black"
            >
              SD
            </span>
            <div>
              <p className="text-lg font-bold">Session drummer</p>
              <p className="text-sm text-slate-300">Mumbai · 8 years · Bollywood, indie, live</p>
            </div>
          </div>
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[.14em] text-slate-300">
            Example
          </span>
        </div>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
          <BadgeCheck aria-hidden="true" size={14} />
          Verified by the Verse team
        </p>
        <ul className="mt-5 space-y-2.5">
          {samples.map(([title, source]) => (
            <li key={title} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-teal-200">
                <Play aria-hidden="true" size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{title}</span>
                <span className="block text-xs text-slate-400">{source}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-white/10 pt-4 text-sm text-slate-300">
          Hirers hear the work first, then message or book.
        </p>
      </div>
    </section>
  );
}
