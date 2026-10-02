import { Link } from 'react-router';
import { ArrowRight, BriefcaseBusiness, MapPin, Mic2, Zap, type LucideIcon } from 'lucide-react';
import { AppSelect, type AppSelectOption } from '../ui/app-select';
import { Photo } from '../media/Photo';
import { trackPathChosen } from '../../lib/analytics';
import { HERO_PHOTO, editorialPhoto } from './photos';

export const LAUNCH_CITIES = ['Mumbai'] as const;
// Live cities, then a disabled row saying more are coming. The shared dark listbox, never the OS one.
const CITY_OPTIONS: AppSelectOption[] = [
  ...LAUNCH_CITIES.map((name) => ({ value: name, label: name, description: null })),
  { value: 'more-cities-soon', label: 'Delhi, Bengaluru, Pune, Goa coming', description: null, disabled: true },
];

/**
 * Above the fold: the promise in one line, the city, and the two ways in, over a full-bleed
 * photograph (the right two-fifths on desktop; behind a scrim on a phone). Sized so that on a
 * 390×844 phone the headline and both path buttons are visible without scrolling.
 */
export function LandingHero({ city, onCityChange }: { city: string; onCityChange: (city: string) => void }) {
  const photo = editorialPhoto(HERO_PHOTO);
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden px-4 pb-12 pt-6 sm:px-6 md:pb-20 md:pt-14"
      data-testid="landing-hero"
    >
      {/* The photo fades into the page with a mask, so it never shows an edge whatever is behind it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-full [mask-image:linear-gradient(to_bottom,#000_0%,#000_20%,transparent_85%)] lg:w-[42%] lg:[mask-composite:intersect] lg:[mask-image:linear-gradient(to_right,transparent_0%,#000_45%),linear-gradient(to_top,transparent_0%,#000_22%)]"
      >
        <Photo
          src={photo.src}
          alt=""
          width={photo.width}
          height={photo.height}
          sizes="(min-width: 1024px) 42vw, 100vw"
          priority
          className="size-full object-cover object-[35%_50%] opacity-35 lg:opacity-100"
        />
      </div>
      <div className="relative mx-auto max-w-6xl">
        <div className="lg:max-w-[56%]">
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
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Singers, session players, DJs and sound crew in {city}: hear their work, then book.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2" data-testid="hero-paths">
            <PathLink
              to="/join/hiring"
              path="hire"
              icon={BriefcaseBusiness}
              primary
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
  primary = false,
}: {
  to: string;
  path: 'hire' | 'musician';
  icon: LucideIcon;
  title: string;
  detail: string;
  /** The one primary action; the other role link is a quieter outline. */
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      onClick={() => trackPathChosen(path)}
      className={`group flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-200 ${
        primary
          ? 'border-white/15 bg-gradient-to-r from-fuchsia-700 to-violet-700 shadow-lg shadow-violet-950/40 hover:from-fuchsia-600 hover:to-violet-600'
          : 'border-white/25 bg-slate-950/50 hover:bg-white/10'
      }`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">
        <Icon aria-hidden="true" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-bold leading-6">{title}</span>
        <span className="block text-[13px] leading-5 text-slate-200">{detail}</span>
      </span>
      <ArrowRight aria-hidden="true" size={18} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
