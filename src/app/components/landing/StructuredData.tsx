/** Organization and WebSite structured data for search engines (schema.org JSON-LD). */
export function StructuredData({ description }: { description: string }) {
  const origin = window.location.origin;
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Verse',
      url: `${origin}/`,
      description,
      areaServed: { '@type': 'City', name: 'Mumbai' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Verse',
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
