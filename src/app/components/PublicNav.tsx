import { Link, useLocation, useNavigate } from 'react-router';
import {
  Briefcase,
  CalendarDays,
  ChevronDown,
  Compass,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Search,
  Users,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { lazy, Suspense, useState } from 'react';
import { BrandMark } from './BrandMark';
import { SkipLink } from './SkipLink';
import { useAuth } from '../lib/authContext';
import { useMounted } from '../lib/clientOnly';
import { SearchSuggestInput, suggestionPath } from './SearchSuggestInput';

const dashboardPathFor = (role: string) => (role === 'employer' ? '/employer' : role === 'admin' ? '/' : '/jobseeker');

const IdentitySwitcher = lazy(() =>
  import('./showcase/IdentitySwitcher').then((m) => ({ default: m.IdentitySwitcher })),
);

const links = [
  ['Music jobs', '/music-jobs', Briefcase],
  ['Musicians', '/music-professionals', Users],
  ['Book music', '/book-music', CalendarDays],
  ['How MusiLynk works', '/guide', Compass],
] as const;

export function PublicNav() {
  const nav = useNavigate();
  const location = useLocation();
  const { status, user, logout } = useAuth();
  const mounted = useMounted();
  const [q, setQ] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const active = (to: string) => location.pathname === to || (to !== '/' && location.pathname.startsWith(`${to}/`));

  return (
    <>
      <nav
        className="sticky top-0 z-50 border-b border-white/10 bg-[#070813]/88 backdrop-blur-2xl"
        aria-label="Public navigation"
      >
        <SkipLink />
        <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-3 px-4 md:px-6">
          <Link to="/" aria-label="MusiLynk home" className="inline-flex min-h-11 shrink-0 items-center">
            <BrandMark />
          </Link>
          <form
            onSubmit={go}
            className="relative ml-3 hidden max-w-xs flex-1 lg:block"
            role="search"
            aria-label="Quick search"
          >
            <label htmlFor="public-search" className="sr-only">
              Search jobs, people and acts
            </label>
            <Search size={16} className="pointer-events-none absolute left-3.5 top-3 z-10 text-slate-400" />
            <SearchSuggestInput
              id="public-search"
              value={q}
              onValueChange={setQ}
              onSelect={(suggestion) => {
                setQ('');
                nav(suggestionPath(suggestion));
              }}
              placeholder="Search the music network"
              className="h-10 w-full rounded-xl border border-white/15 bg-white/[.055] pl-10 pr-3 text-sm outline-none focus:border-violet-300/60 focus:bg-white/[.08] focus-visible:ring-2 focus-visible:ring-violet-300/70"
            />
          </form>
          <div className="ml-auto hidden items-center gap-1 xl:flex">
            {links.map(([label, to, Icon]) => (
              <Button
                key={to}
                variant="ghost"
                size="sm"
                asChild
                className={active(to) ? 'bg-white/10 text-white' : 'text-slate-300'}
              >
                <Link to={to}>
                  <Icon size={15} className="mr-2" />
                  {label}
                </Link>
              </Button>
            ))}
          </div>
          {/* Mounted after hydration: a lazy boundary in pre-rendered HTML must not be hit by an update first. */}
          {mounted && (
            <Suspense fallback={null}>
              <IdentitySwitcher className="ml-auto xl:ml-0" />
            </Suspense>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto xl:hidden" aria-label="Open navigation">
                <Menu size={20} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {links.map(([label, to, Icon]) => (
                <DropdownMenuItem key={to} asChild>
                  <Link to={to}>
                    <Icon size={16} className="mr-2" />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem asChild>
                <Link to="/search">
                  <Search size={16} className="mr-2" />
                  Search everything
                </Link>
              </DropdownMenuItem>
              {status === 'signedOut' && (
                <div className="sm:hidden">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/auth/jobseeker">
                      <LogIn size={16} className="mr-2" />
                      Sign in as a musician
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/auth/employer">
                      <Briefcase size={16} className="mr-2" />
                      Sign in as a hirer
                    </Link>
                  </DropdownMenuItem>
                </div>
              )}
              {status === 'signedIn' && (
                <div className="sm:hidden">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to={dashboardPathFor(user?.role || 'jobseeker')}>
                      <LayoutDashboard size={16} className="mr-2" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void logout()}>
                    <LogOut size={16} className="mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Neutral while the stored session is still hydrating: no auth buttons, so the
              header never flashes the signed-out variant (V-13). */}
          {status === 'signedIn' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="hidden sm:flex" data-testid="account-menu">
                  <LayoutDashboard size={15} className="mr-2" />
                  {user?.name || 'Account'}
                  <ChevronDown size={14} className="ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                  {user?.name}
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link to={dashboardPathFor(user?.role || 'jobseeker')}>
                    <LayoutDashboard size={15} className="mr-2" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  <LogOut size={15} className="mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {status === 'signedOut' && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="hidden sm:flex">
                    <LogIn size={15} className="mr-2" />
                    Sign in
                    <ChevronDown size={14} className="ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to="/auth/jobseeker">
                      <Users size={15} className="mr-2" />
                      Musician account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/auth/employer">
                      <Briefcase size={15} className="mr-2" />
                      Hirer account
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" asChild className="border-0 bg-gradient-to-r from-fuchsia-500 to-violet-500">
                <Link to="/join/musician">
                  Join <span className="hidden min-[400px]:inline">MusiLynk</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </>
  );
}
