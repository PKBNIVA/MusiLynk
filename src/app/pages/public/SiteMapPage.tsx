import { usePageMeta } from '../../components/PageMeta';
import { Link } from 'react-router';
import { PublicNav } from '../../components/PublicNav';
import { PhotoHeader } from '../../components/landing/PhotoHeader';
import { SEO_CITIES, SEO_ROLES, hireLinkText, hirePagePath, ratesPagePath } from '../../lib/seoPages';

const groups: [title: string, links: [label: string, path: string][]][] = [
  [
    'Explore',
    [
      ['Music jobs', '/music-jobs'],
      ['Musicians', '/music-professionals'],
      ['Book music', '/book-music'],
      ['Search everything', '/search'],
    ],
  ],
  [
    'Get started',
    [
      ['Choose your goal', '/start'],
      ['How to use MusiLynk', '/guide'],
      ['Pricing', '/pricing'],
      ['Join as a musician or crew', '/join/musician'],
      ['Join to hire', '/join/hiring'],
      ['Sign in', '/auth/jobseeker'],
    ],
  ],
  [
    'Company & trust',
    [
      ['About', '/about'],
      ['Trust & Safety', '/safety'],
      ['Community guidelines', '/community-guidelines'],
      ['Accessibility', '/accessibility'],
      ['Photo credits', '/credits'],
      ['Contact', '/contact'],
    ],
  ],
  [
    'Legal',
    [
      ['Terms', '/terms'],
      ['Privacy', '/privacy'],
      ['Cookie notice', '/cookies'],
      ['Payments & refunds', '/refund-policy'],
    ],
  ],
];
export default function SiteMapPage() {
  usePageMeta(
    'Site map',
    'Every public area of MusiLynk: music opportunities, musicians, bookable acts, guides, pricing, trust and legal pages.',
    { canonicalPath: '/sitemap' },
  );
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-5xl mx-auto px-5 py-14">
        <PhotoHeader photo="rehearsal-room" eyebrow="Everything in one place" title="Site map">
          <p className="max-w-2xl">
            A human-readable map of the main public areas. Search engines use the XML sitemap at{' '}
            <code className="text-violet-200">/sitemap.xml</code>.
          </p>
        </PhotoHeader>
        <div className="grid md:grid-cols-2 gap-5 mt-10">
          {groups.map(([title, links]) => (
            <section key={title} className="rounded-xl border border-white/10 bg-white/[.035] p-6">
              <h2 className="font-semibold text-xl">{title}</h2>
              <div className="grid gap-3 mt-4">
                {links.map((l) => (
                  <Link key={l[1]} to={l[1]} className="text-violet-300 hover:text-violet-200">
                    {l[0]}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section
          aria-labelledby="hire-map-title"
          className="mt-10 rounded-xl border border-white/10 bg-white/[.035] p-6"
        >
          <h2 id="hire-map-title" className="font-semibold text-xl">
            Hire a musician by role and city
          </h2>
          <p className="text-slate-400 mt-2">
            Every role in every city we list, with what musicians there charge. Mumbai is open first.
          </p>
          <div className="mt-4 divide-y divide-white/10" data-testid="hire-map">
            {SEO_CITIES.map(([citySlug, cityName], index) => (
              <details key={citySlug} open={index === 0} className="group py-3">
                <summary className="cursor-pointer font-medium text-white">{cityName}</summary>
                <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {SEO_ROLES.map(([roleSlug, roleLabel]) => (
                    <li key={roleSlug}>
                      <Link to={hirePagePath(roleSlug, citySlug)} className="text-violet-300 hover:text-violet-200">
                        {hireLinkText(roleLabel, cityName)}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link to={ratesPagePath(citySlug)} className="text-violet-300 hover:text-violet-200">
                      What musicians charge in {cityName}
                    </Link>
                  </li>
                </ul>
              </details>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
