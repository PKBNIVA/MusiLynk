import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Briefcase, CalendarDays, FileAudio, MapPin, MessageSquare, Wallet } from 'lucide-react';
import { PublicNav } from '../../components/PublicNav';
import { PublicDetailState } from '../../components/PublicDetailState';
import { usePageMeta } from '../../components/PageMeta';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/kit/EmptyState';
import { MediaTile } from '../../components/showcase/MediaTile';
import { apiGet } from '../../lib/api';
import { errorMessage, errorStatus } from '../../lib/errors';
import { formatRates, pageJobsPath, type Portfolio } from '../../lib/showcase';

/** ProfilePage structured data for a public portfolio. */
function profilePageJsonLd(p: Portfolio, slug: string) {
  const person: Record<string, unknown> = { '@type': 'Person', name: p.ownerName || p.title };
  if (p.bio) person.description = p.bio;
  return { '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: person, url: `/p/${slug}` };
}

/** Where "Contact" goes for each kind of owner. */
function contact(p: Portfolio) {
  if (p.ownerType === 'act')
    return {
      to: `/acts/${encodeURIComponent(p.ownerId)}`,
      label: `Book ${p.ownerName || 'this act'}`,
      icon: CalendarDays,
    };
  if (p.ownerType === 'organization')
    return {
      to: pageJobsPath({ type: 'organization', id: p.ownerId }),
      label: `See open roles at ${p.ownerName || 'this studio'}`,
      icon: Briefcase,
    };
  return {
    to: `/professionals/${encodeURIComponent(p.ownerId)}`,
    label: `Contact ${p.ownerName?.split(' ')[0] || 'them'}`,
    icon: MessageSquare,
  };
}

/** A public or link-only portfolio as an EPK: who, what they do, rates, and the work itself. */
export default function PublicPortfolio() {
  const { slug = '' } = useParams();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiGet<{ portfolio: Portfolio }>(`/public/portfolios/${encodeURIComponent(slug)}`);
      setPortfolio(d.portfolio);
    } catch (e: unknown) {
      setError({ message: errorMessage(e, 'Unable to load this portfolio.'), status: errorStatus(e) });
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);
  const p = portfolio;
  usePageMeta(
    p ? `${p.ownerName || p.title} — ${p.headline || p.title}` : undefined,
    p ? p.bio || `${p.title} by ${p.ownerName} on MusiLynk${p.city ? `, ${p.city}` : ''}.` : undefined,
    {
      canonicalPath: `/p/${slug}`,
      type: 'website',
      image: p?.items?.[0]?.item?.thumbnailUrl || undefined,
      jsonLd: p ? profilePageJsonLd(p, slug) : undefined,
    },
  );
  if (loading || error || !p)
    return (
      <PublicDetailState
        loading={loading}
        error={error || (!loading && !p ? { message: 'Not found', status: 404 } : null)}
        noun="portfolio"
        backTo="/music-professionals"
        backLabel="Browse musicians"
        onRetry={() => void load()}
      />
    );
  const rates = formatRates(p.rates);
  const cta = contact(p);
  const items = p.items || [];
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-10 md:px-6">
        <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/25 via-fuchsia-500/10 to-teal-400/10 p-6 md:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-violet-200">{p.title}</p>
          <h1 className="mt-3 text-4xl font-bold break-words md:text-6xl">{p.ownerName || p.title}</h1>
          {p.headline && <p className="mt-3 max-w-3xl text-xl text-slate-200 md:text-2xl">{p.headline}</p>}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
            {p.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={16} aria-hidden="true" />
                {p.city}
              </span>
            )}
            {rates && (
              <span className="inline-flex items-center gap-1.5">
                <Wallet size={16} aria-hidden="true" />
                {rates}
              </span>
            )}
          </div>
          {(p.genres || []).length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Genres">
              {(p.genres || []).map((g) => (
                <li key={g} className="rounded-full border border-white/15 bg-white/[.06] px-3 py-1 text-sm">
                  {g}
                </li>
              ))}
            </ul>
          )}
          <Button asChild size="lg" className="mt-6 border-0 bg-gradient-to-r from-fuchsia-500 to-violet-500">
            <Link to={cta.to}>
              <cta.icon size={18} aria-hidden="true" />
              {cta.label}
            </Link>
          </Button>
        </header>

        {p.bio && (
          <section aria-labelledby="epk-bio" className="mt-8 max-w-3xl">
            <h2 id="epk-bio" className="text-2xl font-semibold">
              About
            </h2>
            <p className="mt-3 whitespace-pre-line leading-8 text-slate-300 [overflow-wrap:anywhere]">{p.bio}</p>
          </section>
        )}

        <section aria-labelledby="epk-work" className="mt-10">
          <h2 id="epk-work" className="text-2xl font-semibold">
            Work
          </h2>
          {items.length === 0 ? (
            <EmptyState icon={FileAudio} title="No public work here yet" className="mt-4">
              Check back soon, or browse other musicians.
            </EmptyState>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map(({ item }) => (
                <li key={item.id} className="rounded-2xl border border-white/10 bg-white/[.055] p-4">
                  <h3 className="font-semibold break-words">{item.title}</h3>
                  <p className="mt-0.5 text-xs text-violet-200">
                    {[item.creditedAs, ...(item.roles || []).slice(0, 2), item.year].filter(Boolean).join(' · ')}
                  </p>
                  <div className="mt-3">
                    <MediaTile item={item} />
                  </div>
                  {item.description && <p className="mt-3 line-clamp-3 text-sm text-slate-400">{item.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
