import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { hireLinkText, hirePagePath } from '../../lib/seoPages';

interface PopularSearchItem {
  role: { slug: string; label: string };
  city: { slug: string; name: string };
  count: number;
}

/**
 * The 12 highest-count "Hire a drummer in Mumbai" style pages, Mumbai's before any other city's
 * (GET /api/public/hire-pages/popular-searches). Replaces the old static role tiles with links
 * into the real, indexed role x city landing pages.
 */
export function PopularSearches() {
  const [items, setItems] = useState<PopularSearchItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<{ items: PopularSearchItem[] }>('/public/hire-pages/popular-searches', { skipAuthRedirect: true })
      .then((body) => {
        if (alive) setItems(body.items || []);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (items && items.length === 0) return null;

  return (
    <section aria-labelledby="popular-searches-title" className="px-4 py-16 sm:px-6 md:py-20">
      <div className="mx-auto max-w-6xl">
        <h2 id="popular-searches-title" className="text-2xl font-black md:text-3xl">
          Popular searches
        </h2>
        <p className="mt-2 text-slate-300">Every profile shows real work you can review.</p>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="popular-searches">
          {(items || Array.from({ length: 12 })).map((item, index) => (
            <li key={item ? `${item.role.slug}-${item.city.slug}` : index}>
              {item ? (
                <Link
                  to={hirePagePath(item.role.slug, item.city.slug)}
                  className="group flex min-h-12 items-center justify-between rounded-xl border border-white/10 bg-white/[.03] px-4 text-slate-200 hover:border-violet-300/40 hover:bg-white/[.06] hover:text-white"
                >
                  {hireLinkText(item.role.label, item.city.name)}
                  <ArrowRight aria-hidden="true" size={16} className="text-slate-400 group-hover:text-white" />
                </Link>
              ) : (
                <div aria-hidden="true" className="h-12 rounded-xl border border-white/5 bg-white/[.02]" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
