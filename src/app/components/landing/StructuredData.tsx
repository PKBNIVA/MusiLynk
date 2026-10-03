import { BRAND_NAME } from '../../lib/brand';

/** The public origin the JSON-LD names: VITE_PUBLIC_URL, else the live site. A constant on purpose, so the
 *  pre-rendered HTML and the browser agree byte for byte (window.location.origin differs on previews). */
export const PUBLIC_ORIGIN = String(import.meta.env?.VITE_PUBLIC_URL || 'https://musilynk.vercel.app').replace(
  /\/+$/,
  '',
);

/** Organization and WebSite structured data for search engines (schema.org JSON-LD). */
export function StructuredData({ description }: { description: string }) {
  const origin = PUBLIC_ORIGIN;
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
