import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { HowItWorks } from './HowItWorks';
import { LiveProof } from './LiveProof';
import { TrustStrip } from './TrustStrip';
import { PopularSearches } from './PopularSearches';
import { NowOnVerse } from './NowOnVerse';

/** Everything under the hero, loaded as its own chunk after the first paint. */
export default function LandingBelowFold({ city }: { city: string }) {
  return (
    <>
      <NowOnVerse city={city} />
      <HowItWorks />
      <LiveProof />
      <TrustStrip />
      <PopularSearches />
      <section aria-labelledby="final-title" className="px-4 pb-20 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl border border-violet-300/20 bg-gradient-to-br from-fuchsia-500/15 via-violet-500/10 to-teal-400/10 p-6 md:flex-row md:items-center md:justify-between md:p-10">
          <div>
            <h2 id="final-title" className="text-2xl font-black md:text-4xl">
              Ready when you are.
            </h2>
            <p className="mt-2 text-slate-300">It takes about two minutes, and you can finish your profile later.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <FinalLink to="/join/hiring">I'm hiring</FinalLink>
            <FinalLink to="/join/musician">I'm a musician or crew</FinalLink>
          </div>
        </div>
      </section>
    </>
  );
}

function FinalLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 font-semibold text-slate-950 hover:bg-violet-100"
    >
      {children}
      <ArrowRight aria-hidden="true" size={16} />
    </Link>
  );
}
