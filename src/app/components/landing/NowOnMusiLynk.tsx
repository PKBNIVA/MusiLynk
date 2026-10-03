import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DemoBadge } from '../DemoBadge';
import { VerifiedBadge } from '../VerifiedBadge';
import { UserAvatar } from '../kit/UserAvatar';
import { FirstSample } from '../talent/FirstSample';
import { apiGet } from '../../lib/api';
import { fromRateText } from '../../lib/landing';
import { personLines } from '../../lib/personLine';
import type { Professional } from '../../lib/apiTypes';

// GET /public/talent also sends `photoUrl` (B1); apiTypes.ts does not declare it yet.
type Person = Professional & { photoUrl?: string | null };

const SHOWN = 6;
/** Fewer than this many people and the row would look empty, so it is left out. */
const MIN_SHOWN = 3;

/**
 * "Now on MusiLynk in {city}": up to six people from GET /public/talent (the directory's own order),
 * each with an avatar (their photo, or generated art for a demo account; never a stock face), name,
 * role, "from ₹" and one play chip. Renders nothing on failure or under three people.
 */
export function NowOnMusiLynk({ city }: { city: string }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    let live = true;
    setPeople(null);
    apiGet<{ talent?: Person[] }>(`/public/talent?${new URLSearchParams({ location: city, limit: String(SHOWN) })}`, {
      skipAuthRedirect: true,
      viaEdge: true,
    })
      .then((body) => live && setPeople((body.talent || []).slice(0, SHOWN)))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [city]);

  if (people && people.length < MIN_SHOWN) return null;
  return (
    <section aria-labelledby="now-title" className="px-4 pb-4 pt-2 sm:px-6" data-testid="now-on-musilynk">
      <div className="mx-auto max-w-6xl">
        <h2 id="now-title" className="text-xl font-black md:text-2xl">
          Now on MusiLynk in {city}
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people
            ? people.map((person) => <PersonCard key={person.id} person={person} />)
            : Array.from({ length: SHOWN }, (_, index) => (
                <li
                  key={index}
                  aria-hidden="true"
                  className="h-[7.5rem] rounded-2xl border border-white/5 bg-white/[.02]"
                />
              ))}
        </ul>
      </div>
    </section>
  );
}

function PersonCard({ person }: { person: Person }) {
  const line = personLines(person);
  const from = fromRateText(person);
  return (
    <li className="musilynk-surface flex flex-col gap-3 rounded-2xl p-4" data-testid="now-card">
      <Link
        to={`/professionals/${person.id}`}
        className="group flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <UserAvatar
          id={person.id}
          name={person.name}
          size="lg"
          photoUrl={person.photoUrl}
          demo={person.demo}
          genres={person.genres}
        />
        <span className="min-w-0">
          <span className="block truncate font-bold group-hover:underline">{person.name}</span>
          <span className="block truncate text-sm text-slate-300">{line.primary || 'Musician'}</span>
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
        {person.verified && <VerifiedBadge verification={person.verification} tier={person.verificationTier} />}
        <DemoBadge show={person.demo} />
        {from && <span className="font-semibold text-white">{from}</span>}
      </div>
      <FirstSample id={person.id} />
    </li>
  );
}
