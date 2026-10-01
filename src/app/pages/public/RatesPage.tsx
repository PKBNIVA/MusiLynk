import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { PhotoHeader } from '../../components/landing/PhotoHeader';
import { absoluteUrl, usePageMeta } from '../../components/PageMeta';
import { Button } from '../../components/ui/button';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useAuth } from '../../lib/authContext';
import { ratesPagePath } from '../../lib/seoPages';
import { formatDate, formatMoney } from '../../lib/format';

interface RateRange {
  median: number;
  p25: number;
  p75: number;
  n: number;
}

interface RateRow {
  slug: string;
  label: string;
  n: number;
  hasData: boolean;
  sessionRate: RateRange | null;
  showRate: RateRange | null;
  dayRate: RateRange | null;
}

interface RatesPageData {
  city: { slug: string; name: string };
  roles: RateRow[];
  indexable: boolean;
  updatedAt: string;
}

const formatRange = (range: RateRange | null) =>
  range ? `${formatMoney(range.p25)}–${formatMoney(range.p75)}` : 'Not enough data yet';

export default function RatesPage() {
  const { city = '' } = useParams<{ city: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<RatesPageData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    apiGet<RatesPageData>(`/public/rates/${city}`, { skipAuthRedirect: true })
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
  }, [city]);

  const title = data ? `What musicians charge in ${data.city.name} | Verse` : 'Musician rates';
  const description = data
    ? `Median session, show and day rates reported by verified and unverified musicians on Verse in ${data.city.name}. A guide, not a quote.`
    : undefined;
  const jsonLd = data
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: `Musician and crew rates in ${data.city.name}`,
          description: `Session, show and day rates reported by musicians on Verse in ${data.city.name}.`,
          spatialCoverage: { '@type': 'Place', name: data.city.name },
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Verse', item: absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: 'Musicians', item: absoluteUrl('/music-professionals') },
            {
              '@type': 'ListItem',
              position: 3,
              name: `Rates in ${data.city.name}`,
              item: absoluteUrl(ratesPagePath(data.city.slug)),
            },
          ],
        },
      ]
    : undefined;

  usePageMeta(title, description, {
    canonicalPath: ratesPagePath(city),
    type: 'website',
    // Decided from the first render: noindex until the API confirms there is enough data to index.
    noindex: data ? !data.indexable : true,
    jsonLd,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-5xl mx-auto px-5 py-14">
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
          <>
            <PhotoHeader
              photo="recording-studio"
              eyebrow="Rates guide"
              title={`What musicians charge in ${data.city.name}`}
            >
              <p className="max-w-2xl">
                Ranges reported by verified and unverified musicians on Verse; they are a guide, not a quote.
              </p>
              <p className="mt-3 text-xs text-slate-300">Last updated {formatDate(data.updatedAt)}</p>
            </PhotoHeader>

            <div className="overflow-x-auto mt-8">
              <table className="w-full text-left text-sm" data-testid="rates-table">
                <thead>
                  <tr className="text-slate-400 border-b border-white/10">
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Session</th>
                    <th className="py-2 pr-4">Show</th>
                    <th className="py-2 pr-4">Day</th>
                    <th className="py-2 pr-4">Based on</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roles.map((role) => (
                    <tr key={role.slug} className="border-b border-white/5">
                      <td className="py-3 pr-4 font-medium">{role.label}</td>
                      <td className="py-3 pr-4">{formatRange(role.sessionRate)}</td>
                      <td className="py-3 pr-4">{formatRange(role.showRate)}</td>
                      <td className="py-3 pr-4">{formatRange(role.dayRate)}</td>
                      <td className="py-3 pr-4 text-slate-400">
                        {role.hasData ? `${role.n} profiles` : 'Not enough data yet'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {user?.role === 'jobseeker' && (
              <Button className="mt-8" asChild>
                <Link to="/jobseeker/profile">Add your rates to your profile</Link>
              </Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
