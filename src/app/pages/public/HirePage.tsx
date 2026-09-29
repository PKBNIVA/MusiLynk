import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, MapPin, ShieldCheck } from 'lucide-react';
import { DemoBadge } from '../../components/DemoBadge';
import { usePageMeta } from '../../components/PageMeta';
import { PublicNav } from '../../components/PublicNav';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
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
        if (alive) setError(errorMessage(err, 'This page could not be found.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [role, city]);

  const title = data
    ? `Hire a verified ${data.role.label.toLowerCase()} in ${data.city.name} | Verse`
    : 'Hire on Verse';
  const description = data
    ? `Browse verified ${data.role.label.toLowerCase()}s in ${data.city.name} with real work you can review. Post an urgent request and hear back within hours, or browse the directory.`
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
            { '@type': 'ListItem', position: 1, name: 'Verse', item: '/' },
            { '@type': 'ListItem', position: 2, name: 'Music professionals', item: '/music-professionals' },
            {
              '@type': 'ListItem',
              position: 3,
              name: `${data.role.label} in ${data.city.name}`,
              item: hirePagePath(data.role.slug, data.city.slug),
            },
          ],
        },
      ]
    : undefined;

  usePageMeta(title, description, {
    canonicalPath: hirePagePath(role, city),
    type: 'website',
    noindex: !data || !data.indexable,
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
            <p className="text-rose-300">{error || 'This page could not be found.'}</p>
            <Button variant="outline" className="mt-4" asChild>
              <Link to="/music-professionals">Browse all professionals</Link>
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
      <p className="text-xs uppercase tracking-[.22em] text-violet-300">Music professional directory</p>
      <h1 className="text-4xl md:text-6xl font-bold mt-2">{hireHeading(role.label, city.name)}</h1>
      <p className="text-slate-400 mt-4 max-w-2xl">
        Every profile on Verse shows real work you can review. Browse verified {role.label.toLowerCase()}s in{' '}
        {city.name}, filter by availability, or post an urgent request and hear back within hours.
      </p>

      <dl className="grid grid-cols-3 gap-3 mt-8 max-w-xl" data-testid="hire-stats">
        <StatTile label="Professionals" value={counts.professionals} />
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
            Browse all {role.label.toLowerCase()}s in {city.name}
          </Link>
        </Button>
      </div>

      {featured.length > 0 && (
        <section className="mt-14" aria-labelledby="featured-title">
          <h2 id="featured-title" className="text-2xl font-black">
            Verified {role.label.toLowerCase()}s in {city.name}
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6" data-testid="featured-grid">
            {featured.map((professional) => (
              <Link
                to={`/professionals/${professional.id}`}
                key={professional.id}
                className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <Card className="h-full bg-white/[.05] border-white/10 hover:bg-white/[.075]">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{professional.name}</h3>
                      <DemoBadge show={professional.demo} />
                      {professional.verified && <ShieldCheck size={16} className="text-emerald-300" />}
                    </div>
                    <p className="text-violet-300 mt-1 text-sm">{professional.headline || 'Music professional'}</p>
                    {professional.location && (
                      <p className="flex text-xs text-slate-400 mt-2">
                        <MapPin size={13} className="mr-1" />
                        {professional.location}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
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

      <div className="grid md:grid-cols-2 gap-10 mt-14">
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
    <div className="rounded-xl border border-white/10 bg-white/[.03] p-4 text-center">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-2xl font-black mt-1">{value.toLocaleString('en-IN')}</dd>
    </div>
  );
}
