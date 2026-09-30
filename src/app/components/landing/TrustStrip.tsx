import { Link } from 'react-router';
import { BadgeCheck, Ban, FileCheck2, Star } from 'lucide-react';

/** The four things that make booking a stranger feel safe, in one row. */
export function TrustStrip() {
  const items = [
    [BadgeCheck, 'Verified badges', 'Checked by our team, not self-declared'],
    [FileCheck2, 'Terms in writing', 'The fee and terms are agreed on Verse before anyone is booked'],
    [Star, 'Reviews', 'Read what other hirers said before you book'],
    [Ban, 'Report and block', 'One step, and our team reviews every report'],
  ] as const;
  return (
    <section aria-labelledby="trust-title" className="border-y border-white/10 bg-white/[.025] px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h2 id="trust-title" className="sr-only">
          Trust and safety
        </h2>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(([Icon, title, text]) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300">
                <Icon aria-hidden="true" size={19} />
              </span>
              <span>
                <span className="block font-bold">{title}</span>
                <span className="mt-0.5 block text-sm leading-6 text-slate-300">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-slate-400">
          How we keep people safe:{' '}
          <Link to="/safety" className="text-slate-200 underline underline-offset-4 hover:text-white">
            read our safety page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
