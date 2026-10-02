import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { DemoBadge } from '../../components/DemoBadge';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { UserAvatar } from '../../components/kit/UserAvatar';
import { PhotoHeader } from '../../components/landing/PhotoHeader';
import { ROLE_PHOTOS } from '../../components/landing/photos';
import { absoluteUrl, usePageMeta } from '../../components/PageMeta';
import { PublicNav } from '../../components/PublicNav';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fromRateText, roleNoun } from '../../lib/landing';
import { personLines } from '../../lib/personLine';
import { hireHeading, hireLinkText, hirePagePath } from '../../lib/seoPages';
import type { Professional } from '../../lib/apiTypes';

interface HirePageData {
  role: { slug: string; label: string };
  city: { slug: string; name: string };
  counts: { professionals: number; verified: number; availableThisWeek: number };
  featured: Professional[];
  relatedRoles: { slug: string; label: string; count: number }[];
  nearbyCities: { slug: string; name: string }[];
  indexable: boolean;
  ratesPath: string;
  faq: { question: string; answer: string }[];
}

export default function HirePage() {
  const { role = '', city = '' } = useParams<{ role: string; city: string }>();
  const [data, setData] = useState<HirePageData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    apiGet<HirePageData>(`/public/hire-pages/${role}/${city}`, { skipAuthRedirect: true })
      .then((body) => {
        if (alive) setData(body);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err, 'This page could not be found. Check the link or pick another city.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [role, city]);

  const title = data
    ? `Hire a verified ${roleNoun(data.role.label)} in ${data.city.name} | MusiLynk`
    : 'Hire on MusiLynk';
  const description = data
    ? `Browse verified ${roleNoun(data.role.label)}s in ${data.city.name} with real work you can review. Post an urgent request and hear back within hours, or browse the directory.`
    : undefined;
  const jsonLd = data
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: data.faq.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'MusiLynk', item: absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: 'Musicians', item: absoluteUrl('/music-professionals') },
            {
              '@type': 'ListItem',
              position: 3,
              name: `${data.role.label} in ${data.city.name}`,
              item: absoluteUrl(hirePagePath(data.role.slug, data.city.slug)),
            },
          ],
        },
      ]
    : undefined;

  usePageMeta(title, description, {
    canonicalPath: hirePagePath(role, city),
    type: 'website',
    // Decided from the first render: noindex until the API confirms the page has enough to index, so a
    // thin page is never indexable even for an instant. A failed lookup is not a page either.
    noindex: data ? !data.indexable : true,
    jsonLd,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-6xl mx-auto px-5 py-14">
        {loading ? (
          <p className="text-slate-400 text-center py-16" role="status">
            Loading…
          </p>
        ) : error || !data ? (
          <div className="text-center py-16" role="alert">
            <p className="text-rose-300">
              {error || 'This page could not be found. Check the link or pick another city.'}
            </p>
            <Button variant="outline" className="mt-4" asChild>
              <Link to="/music-professionals">Browse all musicians</Link>
            </Button>
          </div>
        ) : (
          <HirePageContent data={data} />
        )}
      </main>
    </div>
  );
}

function HirePageContent({ data }: { data: HirePageData }) {
  const { role, city, counts, featured, relatedRoles, nearbyCities, faq, ratesPath } = data;
  const urgentPath = `/urgent?${new URLSearchParams({ role: role.label, city: city.name }).toString()}`;
  const browsePath = `/music-professionals?${new URLSearchParams({ role: role.slug, location: city.name }).toString()}`;

  return (
    <>
      <PhotoHeader
        photo={ROLE_PHOTOS[role.slug] ?? 'rehearsal-room'}
        eyebrow="Musician directory"
        title={hireHeading(role.label, city.name)}
      >
        <p className="max-w-2xl">
          Every profile on MusiLynk shows real work you can review. Browse verified {roleNoun(role.label)}s in{' '}
          {city.name}, filter by availability, or post an urgent request and hear back within hours.
        </p>
      </PhotoHeader>

      <dl className="grid grid-cols-3 gap-3 mt-6 max-w-xl" data-testid="hire-stats">
        <StatTile label="Musicians" value={counts.professionals} />
        <StatTile label="Verified" value={counts.verified} />
        <StatTile label="Available this week" value={counts.availableThisWeek} />
      </dl>

      <div className="flex flex-col sm:flex-row gap-3 mt-8">
        <Button asChild>
          <Link to={urgentPath} data-testid="urgent-cta">
            Post an urgent request
            <ArrowRight aria-hidden="true" size={16} className="ml-2" />
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to={browsePath}>
            Browse all {roleNoun(role.label)}s in {city.name}
          </Link>
        </Button>
      </div>

      {featured.length > 0 && (
        <section className="mt-14" aria-labelledby="featured-title">
          <h2 id="featured-title" className="text-2xl font-black">
            Verified {roleNoun(role.label)}s in {city.name}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6" data-testid="featured-grid">
            {featured.map((professional) => (
              <PersonCard key={professional.id} professional={professional} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-14" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-2xl font-black">
          Frequently asked questions
        </h2>
        <Accordion type="single" collapsible className="mt-4">
          {faq.map((item, index) => (
            <AccordionItem key={item.question} value={`faq-${index}`}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
        <Link
          to={ratesPath}
          className="mt-4 inline-flex items-center gap-1 text-sm text-violet-300 hover:text-violet-200"
        >
          See what musicians charge in {city.name}
          <ArrowRight aria-hidden="true" size={14} />
        </Link>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-14">
        {relatedRoles.length > 0 && (
          <section aria-labelledby="related-roles-title">
            <h2 id="related-roles-title" className="text-lg font-bold">
              Related roles in {city.name}
            </h2>
            <ul className="mt-3 space-y-2">
              {relatedRoles.map((related) => (
                <li key={related.slug}>
                  <Link to={hirePagePath(related.slug, city.slug)} className="text-slate-300 hover:text-white">
                    {hireLinkText(related.label, city.name)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {nearbyCities.length > 0 && (
          <section aria-labelledby="nearby-cities-title">
            <h2 id="nearby-cities-title" className="text-lg font-bold">
              {role.label}s in nearby cities
            </h2>
            <ul className="mt-3 space-y-2">
              {nearbyCities.map((nearby) => (
                <li key={nearby.slug}>
                  <Link to={hirePagePath(role.slug, nearby.slug)} className="text-slate-300 hover:text-white">
                    {hireLinkText(role.label, nearby.name)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[.03] p-3 text-center sm:p-4">
      <dt className="text-xs normal-case break-words text-slate-400 sm:uppercase sm:tracking-wide">{label}</dt>
      <dd className="text-2xl font-black mt-1">{value.toLocaleString('en-IN')}</dd>
    </div>
  );
}

type Featured = Professional & { photoUrl?: string | null };

function PersonCard({ professional }: { professional: Featured }) {
  const line = personLines(professional);
  const from = fromRateText(professional);
  return (
    <Link
      to={`/professionals/${professional.id}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-white/[.05] p-5 hover:bg-white/[.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
    >
      <span className="flex items-center gap-3">
        <UserAvatar
          id={professional.id}
          name={professional.name}
          size="lg"
          photoUrl={professional.photoUrl}
          demo={professional.demo}
          genres={professional.genres}
        />
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold">{professional.name}</span>
          <span className="block truncate text-sm text-violet-300">{line.primary || 'Musician'}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-300">
        {professional.verified && (
          <VerifiedBadge verification={professional.verification} tier={professional.verificationTier} />
        )}
        <DemoBadge show={professional.demo} />
        {from && <span className="font-semibold text-white">{from}</span>}
      </span>
    </Link>
  );
}
