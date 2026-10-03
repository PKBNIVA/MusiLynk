import { lazy, Suspense, useState } from 'react';
import { usePageMeta } from '../components/PageMeta';
import { useIdleReady } from '../App';
import { PUBLIC_PAGE_META } from '../lib/siteMeta';
import { SkipLink } from '../components/SkipLink';
import { LandingFooter, LandingHeader } from '../components/landing/LandingHeader';
import { LAUNCH_CITIES, LandingHero } from '../components/landing/LandingHero';
import { StructuredData } from '../components/landing/StructuredData';

// Below the fold (how it works, live proof, trust, role links) is its own chunk, fetched once the
// browser is idle after the hero has painted, so it never shares the connection with the hero photo.
const LandingBelowFold = lazy(() => import('../components/landing/LandingBelowFold'));
const belowFoldPlaceholder = <div aria-hidden="true" className="min-h-[70vh]" />;

const { title: TITLE, description: DESCRIPTION } = PUBLIC_PAGE_META['/'];

export default function LandingPage() {
  usePageMeta(TITLE, DESCRIPTION, { canonicalPath: '/', type: 'website' });
  const [city, setCity] = useState<string>(LAUNCH_CITIES[0]);
  const belowFoldReady = useIdleReady();
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <SkipLink />
      <LandingHeader />
      <main>
        <LandingHero city={city} onCityChange={setCity} />
        {belowFoldReady ? (
          <Suspense fallback={belowFoldPlaceholder}>
            <LandingBelowFold city={city} />
          </Suspense>
        ) : (
          belowFoldPlaceholder
        )}
      </main>
      <LandingFooter />
      <StructuredData description={DESCRIPTION} />
    </div>
  );
}
