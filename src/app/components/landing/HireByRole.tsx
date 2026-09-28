import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { HIRE_ROLES, hireLinkText, hireSearchPath } from '../../lib/landing';

/** "Hire a drummer in Mumbai" links into the directory's role and city filters (also good for search engines). */
export function HireByRole({ city }: { city: string }) {
  return (
    <section aria-labelledby="hire-title" className="px-4 py-16 sm:px-6 md:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="hire-title" className="text-2xl font-black md:text-3xl">
          Musicians and crew in {city}
        </h2>
        <p className="mt-2 text-slate-300">Browse by role. Every profile shows real work you can play.</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {HIRE_ROLES.map(([role, label]) => (
            <li key={role}>
              <Link
                to={hireSearchPath(role, city)}
                className="group flex min-h-12 items-center justify-between rounded-xl border border-white/10 bg-white/[.03] px-4 text-slate-200 hover:border-violet-300/40 hover:bg-white/[.06] hover:text-white"
              >
                {hireLinkText(label, city)}
                <ArrowRight aria-hidden="true" size={16} className="text-slate-400 group-hover:text-white" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
