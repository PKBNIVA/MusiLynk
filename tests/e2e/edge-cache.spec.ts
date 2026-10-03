import { expect, test, type Response } from '@playwright/test';
import { openSettledPage } from './qa-helpers';

// The landing page's three anonymous public reads are edge-cacheable (docs/ops/edge-caching.md):
// counters, featured talent and the Stage teaser. Live (QA_BASE_URL) and integration runs see real
// headers: `x-vercel-cache` once the call goes through Vercel's same-origin rewrite, or the API's own
// `Cache-Control: public, s-maxage=...` when it is called directly. The mocked run has no backend, so
// it checks the calls themselves (made once each, anonymous) and leaves headers to the Rails tests
// (backend/test/integration/edge_caching_test.rb).
const PUBLIC_READS = [
  ['public stats', /\/api\/public\/stats$/],
  ['featured talent', /\/api\/public\/talent$/],
  ['Stage teaser', /\/api\/stage\/authors\/system\/musilynk\/posts$/],
] as const;
const realHeaders = Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true';

test('the landing page makes its three public reads once, anonymously, and they are edge-cacheable', async ({
  page,
}) => {
  const seen = new Map<string, Response[]>();
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    for (const [name, pattern] of PUBLIC_READS) {
      if (pattern.test(pathname)) seen.set(name, [...(seen.get(name) ?? []), response]);
    }
  });

  await openSettledPage(page, '/');
  // The below-the-fold components are lazy: wait for every read to have been made.
  await expect
    .poll(() => PUBLIC_READS.filter(([name]) => seen.has(name)).length, { timeout: 15_000 })
    .toBe(PUBLIC_READS.length);

  for (const [name] of PUBLIC_READS) {
    const responses = seen.get(name)!;
    expect(responses, `${name} is read once per visit`).toHaveLength(1);
    const [response] = responses;
    expect(response.request().headers()['authorization'], `${name} is read anonymously`).toBeUndefined();
    expect(response.status(), `${name} status`).toBe(200);
    if (!realHeaders) continue;

    const headers = response.headers();
    const control = headers['cache-control'] ?? '';
    const edge = headers['x-vercel-cache'];
    // Served through Vercel's rewrite: the edge reports its cache state (and strips s-maxage).
    // Called directly: the API's shared-cache lifetime is visible as-is.
    const cacheable = edge !== undefined || /\bs-maxage=\d+/.test(control);
    expect(cacheable, `${name}: cache-control="${control}" x-vercel-cache="${edge ?? ''}"`).toBe(true);
    expect(control, `${name} is never private`).not.toMatch(/\bprivate\b|no-store/);
    if (edge === undefined) {
      expect(control).toMatch(/\bpublic\b/);
      expect(control).toMatch(/\bstale-while-revalidate=\d+/);
      expect(headers['etag'], `${name} has an ETag`).toBeTruthy();
      expect(headers['vary'] ?? '', `${name} varies on Authorization`).toMatch(/authorization/i);
    }
  }
});
