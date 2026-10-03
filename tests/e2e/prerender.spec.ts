import { expect, test, type Page } from '@playwright/test';

// The public pages ship their first screen as HTML (scripts/prerender-heads.mjs + src/entry-server.tsx)
// and main.tsx hydrates it in place. Two things must hold on every pre-rendered route, on a phone and a
// desktop: the HTML already carries the page's heading before any script runs, and hydration is a no-op
// (React logs a recoverable error on any mismatch; none may appear).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Reads the local build.');

// [URL to open, the built file Vercel serves for it, heading text the HTML must already carry]. vite preview
// has no vercel.json, so each test serves that file for its URL itself (as the rewrites and the static
// directory indexes do in production) and reads it raw for the no-JavaScript check.
const ROUTES: Array<[string, string, RegExp]> = [
  ['/', '/index.html', /Hire a verified musician for your session or gig/],
  ['/music-jobs', '/music-jobs/index.html', /Music jobs, gigs, sessions, auditions/],
  ['/music-professionals', '/music-professionals/index.html', /<h1/],
  ['/book-music', '/book-music/index.html', /<h1/],
  ['/urgent', '/urgent/index.html', /Find a verified musician, fast/],
  ['/pricing', '/pricing/index.html', /<h1/],
  ['/guide', '/guide/index.html', /<h1/],
  ['/join/musician', '/join/musician/index.html', /<h1/],
  ['/join/hiring', '/join/hiring/index.html', /<h1/],
  ['/hire/drummer/mumbai', '/hire/drummer/mumbai/index.html', /Hire a verified drummer in Mumbai/],
  ['/rates/mumbai', '/rates/mumbai/index.html', /What musicians charge in Mumbai/],
  // Record pages: one shell per family, served for every id.
  ['/professionals/user_1', '/professionals/shell.html', /role="status">Loading/],
  ['/acts/act_1', '/acts/shell.html', /role="status">Loading/],
  ['/opportunities/job_1', '/opportunities/shell.html', /role="status">Loading/],
];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    // Network status lines ("Failed to load resource: 404") are the mocked API, not the page's JavaScript.
    if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

for (const [url, file, heading] of ROUTES) {
  test(`${url} is pre-rendered and hydrates without a mismatch`, async ({ page, request }) => {
    // The HTML as a crawler or a visitor with no script yet sees it.
    const html = await (await request.get(file)).text();
    expect(html).toMatch(/<div id="root" data-prerendered="[^"]+">./);
    expect(html).toMatch(heading);

    const errors = collectErrors(page);
    // The hire and rates pages need their record or a 404 (an empty object is neither); everything else gets {}.
    await page.route('**/api/**', (route) =>
      /\/api\/public\/(hire-pages|rates)\//.test(route.request().url())
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.route(
      (candidate) => candidate.pathname === url,
      (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
    );
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => document.getElementById('root')?.dataset.hydrated)).toBe('true');
    // The lazy page chunk has arrived and taken over the server markup.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    expect(errors, errors.join('\n')).toEqual([]);
    // Hydration kept the markup: the heading is still there and interactive controls work.
    await expect(page.locator('h1, [role="status"], [role="alert"]').first()).toBeVisible();
  });
}

test('the home HTML served for a different URL is not hydrated against it', async ({ page }) => {
  // A static host may fall back to index.html for a path it has no file for (vite preview does this for
  // /search); main.tsx must then render from scratch instead of hydrating the landing markup.
  const errors = collectErrors(page);
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('root')?.dataset.hydrated)).toBeUndefined();
  expect(errors).toEqual([]);
});
