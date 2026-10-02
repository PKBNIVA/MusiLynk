import { useEffect } from 'react';
import { Link } from 'react-router';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '../ui/button';
import { BrandMark } from '../BrandMark';
import { useAuth } from '../../lib/authContext';
import { openProblemReport } from '../../lib/problemReportEvent';
import { watchClientErrors } from '../../lib/recentErrors';

const dashboardPathFor = (role: string) => (role === 'employer' ? '/employer' : role === 'admin' ? '/' : '/jobseeker');

/** The landing page's slim top bar: the brand, three ways in, and sign-in. While the stored
 * session is still hydrating, the sign-in/dashboard slot stays empty rather than flashing the
 * signed-out "Sign in" button (V-13). */
export function LandingHeader() {
  const { status, user } = useAuth();
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#070813]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="/" aria-label="MusiLynk home" className="inline-flex min-h-11 shrink-0 items-center rounded-xl">
          <BrandMark />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Primary navigation">
          <Button variant="ghost" size="sm" className="hidden text-slate-200 md:inline-flex" asChild>
            <Link to="/music-professionals">Browse musicians</Link>
          </Button>
          <Button variant="ghost" size="sm" className="hidden text-slate-200 md:inline-flex" asChild>
            <Link to="/music-jobs">Find work</Link>
          </Button>
          <Button variant="ghost" size="sm" className="hidden text-slate-200 sm:inline-flex" asChild>
            {/* Same-page anchor; a plain link so the browser scrolls without a route change. */}
            <a href="/#how-it-works">How it works</a>
          </Button>
          {status === 'signedIn' && (
            <Button variant="outline" size="sm" className="border-white/20" asChild data-testid="account-menu">
              <Link to={dashboardPathFor(user?.role || 'jobseeker')}>
                <LayoutDashboard size={15} className="mr-2" />
                Dashboard
              </Link>
            </Button>
          )}
          {status === 'signedOut' && (
            <Button variant="outline" size="sm" className="border-white/20" asChild>
              <Link to="/auth/jobseeker">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}

export function LandingFooter() {
  useEffect(watchClientErrors, []);
  const links = [
    ['How MusiLynk works', '/guide'],
    ['Pricing', '/pricing'],
    ['Musician rates in Mumbai', '/rates/mumbai'],
    ['Safety', '/safety'],
    ['Privacy', '/privacy'],
    ['Terms', '/terms'],
    ['Photo credits', '/credits'],
    ['Site map', '/sitemap'],
    ['Contact', '/contact'],
  ] as const;
  return (
    <footer className="border-t border-white/10 px-4 py-9 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-6 text-sm text-slate-400 md:flex-row md:items-center">
        <div>
          <BrandMark />
          <p className="mt-3 max-w-sm text-xs leading-5 text-slate-400">
            Verified musicians and crew for sessions, weddings, events and tours. Starting in Mumbai.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
          {links.map(([label, to]) => (
            <Link key={to} to={to} className="inline-flex min-h-10 min-w-10 items-center hover:text-white">
              {label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => openProblemReport()}
            className="inline-flex min-h-10 min-w-10 items-center hover:text-white"
          >
            Report a problem
          </button>
        </nav>
      </div>
    </footer>
  );
}
