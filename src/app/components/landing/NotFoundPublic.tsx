import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Briefcase, CalendarDays, Search, Users, type LucideIcon } from 'lucide-react';
import { PublicNav } from '../PublicNav';

const ROLE_LINKS: readonly (readonly [LucideIcon, string, string, string])[] = [
  [Users, 'Hire a musician', 'Browse verified musicians and crew', '/music-professionals'],
  [Briefcase, 'Find work', 'Gigs, sessions and auditions', '/music-jobs'],
  [CalendarDays, 'Book a live act', 'Bands, duos and ensembles', '/book-music'],
];

/** The public site's 404: the app palette and nav, a search box and the three ways back in. */
export default function NotFoundPublic() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const go = (event: FormEvent) => {
    event.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-3xl px-5 py-16 text-center md:py-24">
        <p aria-hidden="true" className="verse-gradient-text text-7xl font-black md:text-9xl">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">Page not found</h1>
        <p className="mx-auto mt-3 max-w-md text-slate-300">
          That page has moved or never existed. Search MusiLynk, or start from one of these.
        </p>
        <form onSubmit={go} role="search" aria-label="Search MusiLynk" className="mx-auto mt-8 flex max-w-md gap-2">
          <label htmlFor="not-found-search" className="sr-only">
            Search jobs, people and acts
          </label>
          <input
            id="not-found-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs, people and acts"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[.06] px-3.5 text-base outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-violet-300/70"
          />
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 font-semibold text-slate-950 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            <Search aria-hidden="true" size={16} />
            Search
          </button>
        </form>
        <ul className="mt-10 grid gap-3 text-left sm:grid-cols-3" data-testid="not-found-links">
          {ROLE_LINKS.map(([Icon, title, detail, to]) => (
            <li key={to}>
              <Link
                to={to}
                className="verse-surface flex h-full flex-col gap-1 rounded-2xl p-4 hover:bg-white/[.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
              >
                <Icon aria-hidden="true" size={20} className="text-violet-300" />
                <span className="mt-1 font-bold">{title}</span>
                <span className="text-sm text-slate-300">{detail}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-sm text-slate-400">
          <Link to="/" className="underline underline-offset-4 hover:text-white">
            Back to the home page
          </Link>
        </p>
      </main>
    </div>
  );
}
