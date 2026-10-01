import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Zap } from 'lucide-react';
import { SEO_ROLES } from '../../lib/seoPages';
import { defaultUrgentStartAt, urgentPath } from '../../lib/landing';
import { formatInputEcho } from '../../lib/format';

const FIELD =
  'h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-base text-white placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300';

/**
 * "Need someone by tomorrow": the urgent form's first two fields (role, when) inline. Submitting
 * opens the real form at /urgent with both filled in; signing in only gates sending it.
 */
export function UrgentBand({ city }: { city: string }) {
  const navigate = useNavigate();
  const [role, setRole] = useState('');
  const [startAt, setStartAt] = useState(() => defaultUrgentStartAt());
  const go = (event: FormEvent) => {
    event.preventDefault();
    navigate(urgentPath({ role, city, startAt }));
  };
  return (
    <section aria-labelledby="urgent-band-title" className="px-4 pb-16 sm:px-6 md:pb-20">
      <div className="mx-auto grid max-w-6xl gap-6 rounded-3xl border border-amber-300/20 bg-gradient-to-br from-amber-400/10 via-fuchsia-500/5 to-transparent p-6 md:p-10 lg:grid-cols-[.75fr_1.25fr] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-amber-200">
            <Zap aria-hidden="true" size={14} />
            Urgent
          </p>
          <h2 id="urgent-band-title" className="mt-2 text-2xl font-black md:text-4xl">
            Need someone by tomorrow?
          </h2>
          <p className="mt-2 text-slate-300">We tell verified musicians nearby right away. Free to post.</p>
        </div>
        <form onSubmit={go} className="grid gap-3 sm:grid-cols-[1.3fr_1fr_auto] sm:items-end" data-testid="urgent-band">
          <div>
            <label htmlFor="band-role" className="mb-1 block text-sm font-semibold text-slate-200">
              Role needed
            </label>
            <input
              id="band-role"
              list="band-roles"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Drummer, singer…"
              autoComplete="off"
              className={FIELD}
            />
            <datalist id="band-roles">
              {SEO_ROLES.map(([slug, label]) => (
                <option key={slug} value={label} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="band-when" className="mb-1 block text-sm font-semibold text-slate-200">
              Date &amp; time
            </label>
            <input
              id="band-when"
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className={FIELD}
            />
            {startAt && <p className="mt-1 text-xs text-slate-400">{formatInputEcho(startAt, true)}</p>}
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 font-semibold text-slate-950 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            Continue
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}
