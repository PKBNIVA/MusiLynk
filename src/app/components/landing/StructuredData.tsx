import { BRAND_NAME } from '../../lib/brand';
import { publicOrigin } from '../../lib/siteMeta';

/** Organization and WebSite structured data for search engines (schema.org JSON-LD). The origin is the
 *  configured public one (lib/siteMeta.ts), never window.location, so pre-rendered HTML and browser agree. */
export function StructuredData({ description }: { description: string }) {
  const origin = publicOrigin();
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: BRAND_NAME,
      url: `${origin}/`,
      description,
      areaServed: { '@type': 'City', name: 'Mumbai' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: BRAND_NAME,
      url: `${origin}/`,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${origin}/search?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
  // "<" is escaped so the JSON can never close the script element.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
