import { Link } from 'react-router';
import { AppSelect, type AppSelectOption } from '../ui/app-select';
import { useEffect, useState } from 'react';
import { ArrowRight, BadgeCheck, BriefcaseBusiness, MapPin, Mic2, Zap, type LucideIcon } from 'lucide-react';
import { personLines } from '../../lib/personLine';
import { UserAvatar } from '../kit/UserAvatar';
import { PlayChipButton } from '../kit/PlayChip';
import { apiGet } from '../../lib/api';
import { trackPathChosen } from '../../lib/analytics';
import type { PortfolioItem, Professional } from '../../lib/apiTypes';

export const LAUNCH_CITIES = ['Mumbai'] as const;
// Live cities, then a disabled row saying more are coming. The shared dark listbox, never the OS one.
const CITY_OPTIONS: AppSelectOption[] = [
  ...LAUNCH_CITIES.map((name) => ({ value: name, label: name, description: null })),
  { value: 'more-cities-soon', label: 'More cities soon', description: null, disabled: true },
];

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
            <span id="landing-city-label">Now booking in</span>
            <AppSelect
              id="landing-city"
              aria-labelledby="landing-city-label landing-city"
              value={city}
              onValueChange={(value) => value && onCityChange(value)}
              options={CITY_OPTIONS}
              className="h-11 w-auto rounded-full bg-slate-900 px-3.5 font-semibold text-white sm:h-9"
              contentClassName="min-w-48"
            />
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
              path="hire"
              icon={BriefcaseBusiness}
              title="I'm hiring"
              detail="Studios, weddings, events and bands"
            />
            <PathLink
              to="/join/musician"
              path="musician"
              icon={Mic2}
              title="I'm a musician or crew"
              detail="Get booked for sessions and gigs"
            />
          </div>
          <VerifiedRow city={city} />
          <div className="mt-5 space-y-1">
            <Link
              to="/urgent"
              className="group inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-amber-200 hover:text-amber-100"
            >
              <Zap aria-hidden="true" size={17} />
              Need someone by tomorrow? Post an urgent request
              <ArrowRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="text-sm text-slate-400">
              Free to post. Fill it in first; you create an account or sign in to send it.
            </p>
          </div>
        </div>
        <ExampleProfile />
      </div>
    </section>
  );
}

function PathLink({
  to,
  path,
  icon: Icon,
  title,
  detail,
}: {
  to: string;
  path: 'hire' | 'musician';
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <Link
      to={to}
      onClick={() => trackPathChosen(path)}
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
        <div className="mt-5 flex flex-col items-start gap-2" ref={makeStatic}>
          {DEMO_SAMPLES.map((sample) => (
            <PlayChipButton key={sample.id} sample={sample} onOpen={() => {}} />
          ))}
        </div>
        <div aria-hidden="true" className="mt-4 flex h-10 items-end gap-2" data-testid="example-waveform">
          {[40, 75, 55, 100, 65, 85].map((h, i) => (
            <span
              key={i}
              className="w-2 rounded-full bg-gradient-to-t from-fuchsia-500/60 to-violet-400/60"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <p className="mt-5 border-t border-white/10 pt-4 text-sm text-slate-300">
          Hirers hear the work first, then message or book.
        </p>
      </div>
    </section>
  );
}

// Static demo samples for the example card. They look like the real play chips but do nothing.
const DEMO_SAMPLES: PortfolioItem[] = [
  ['Live at a sangeet, Bandra', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['Studio session, Marathi single', 'https://soundcloud.com/verse-demo/marathi-single'],
  ['Drums on a 30-second ad jingle', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'],
].map(([title, url], i) => ({ id: `demo-${i}`, kind: 'link', type: 'link', title, url }));

// The chips are a picture of the real thing, not controls: keep them out of the tab order.
const makeStatic = (el: HTMLElement | null) => el?.setAttribute('inert', '');

/** Up to six people in the chosen city under the hero buttons. Verified people are preferred and the
 * caption only says "Verified" when every face shown is. Renders nothing on failure or under 3 people. */
function VerifiedRow({ city }: { city: string }) {
  const [state, setState] = useState<{ people: Professional[]; verified: boolean }>({ people: [], verified: false });
  useEffect(() => {
    let live = true;
    setState({ people: [], verified: false });
    apiGet<{ talent?: Professional[]; total?: number }>(
      `/public/talent?${new URLSearchParams({ location: city, limit: '12' })}`,
    )
      .then((d) => {
        if (!live) return;
        const all = d.talent || [];
        const verified = all.filter((p) => p.verified);
        if (verified.length >= 3) setState({ people: verified.slice(0, 6), verified: true });
        else if ((d.total ?? all.length) >= 3 && all.length >= 3)
          setState({ people: all.slice(0, 6), verified: false });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [city]);
  const { people, verified } = state;
  if (!people.length) return null;
  return (
    <div className="mt-5" data-testid="verified-row">
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {people.map((p) => {
          const line = personLines(p);
          return (
            <li key={p.id} className="flex items-center gap-2">
              <UserAvatar id={p.id} name={p.name} size="sm" />
              <span className="text-sm text-slate-200">
                {p.name.split(' ')[0]}
                {line.primary && <span className="sr-only">, {line.primary}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[.06] px-2.5 py-1 text-xs text-slate-300">
        <MapPin aria-hidden="true" size={13} className="text-teal-300" />
        {verified ? `Verified in ${city}` : `Now on Verse in ${city}`}
      </p>
    </div>
  );
}
