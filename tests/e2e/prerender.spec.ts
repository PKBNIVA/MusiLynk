import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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
  ['/professionals/user_1', '/professionals/shell.html', /role="status" aria-label="Loading/],
  ['/acts/act_1', '/acts/shell.html', /role="status" aria-label="Loading/],
  ['/opportunities/job_1', '/opportunities/shell.html', /role="status" aria-label="Loading/],
];

/** The HTML's text for an attribute or element back to characters. */
const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

// What the hire and rates pages load (the shapes HirePage.test.tsx and RatesPage.test.tsx use).
const HIRE_PAGE = {
  role: { slug: 'drummer', label: 'Drummer' },
  city: { slug: 'mumbai', name: 'Mumbai' },
  counts: { professionals: 8, verified: 3, availableThisWeek: 2 },
  featured: [],
  relatedRoles: [{ slug: 'guitarist', label: 'Guitarist', count: 6 }],
  nearbyCities: [{ slug: 'pune', name: 'Pune' }],
  indexable: true,
  ratesPath: '/rates/mumbai',
  faq: [{ question: 'How much does a session drummer in Mumbai charge?', answer: 'It varies; ask for a quote.' }],
};
const RATES_PAGE = {
  city: { slug: 'mumbai', name: 'Mumbai' },
  roles: [
    {
      slug: 'drummer',
      label: 'Drummer',
      n: 8,
      hasData: true,
      sessionRate: { median: 4000, p25: 3000, p75: 5000, n: 8 },
      showRate: null,
      dayRate: null,
    },
  ],
  indexable: true,
  updatedAt: '2026-09-01T00:00:00Z',
};

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
    // The hire and rates pages get their record (an empty object is neither a record nor a 404); everything else {}.
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = /\/api\/public\/hire-pages\//.test(path)
        ? HIRE_PAGE
        : /\/api\/public\/rates\//.test(path)
          ? RATES_PAGE
          : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
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
    // The head the client sets is the head the HTML carried (both come from src/app/lib/siteMeta.ts).
    const bakedTitle = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
    const bakedDescription = decode(/<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? '');
    if (!url.startsWith('/professionals') && !url.startsWith('/acts') && !url.startsWith('/opportunities')) {
      await expect.poll(() => page.title()).toBe(bakedTitle);
      expect(await page.locator('meta[name="description"]').getAttribute('content')).toBe(bakedDescription);
    }
  });
}

/** Opens `url` with the built `file` served for it, the API mocked and every console error collected. */
async function openPrerendered(
  page: Page,
  request: APIRequestContext,
  url: string,
  file: string,
  api?: Parameters<Page['route']>[1],
) {
  const html = await (await request.get(file)).text();
  const errors = collectErrors(page);
  await page.route(
    '**/api/**',
    api ?? ((route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })),
  );
  await page.route(
    (candidate) => candidate.pathname === new URL(url, 'http://x').pathname,
    (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => document.getElementById('root')?.dataset.hydrated)).toBe('true');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
  return errors;
}

test.describe('what the HTML cannot know is applied after hydration, never baked', () => {
  test('/urgent two days after the build still hydrates, then shows tomorrow 6 pm', async ({ page, request }) => {
    await page.clock.setFixedTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const errors = await openPrerendered(page, request, '/urgent', '/urgent/index.html');
    expect(errors).toEqual([]);
    const expected = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const value = await page.locator('input[type="datetime-local"]').first().inputValue();
    expect(value.slice(0, 10)).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`,
    );
    expect(value.slice(11)).toBe('18:00');
  });

  test('/urgent?role=&city= (the hire page CTA) hydrates and prefills the form', async ({ page, request }) => {
    const errors = await openPrerendered(page, request, '/urgent?role=Drummer&city=Mumbai', '/urgent/index.html');
    expect(errors).toEqual([]);
    await expect(page.locator('#urgent-role')).toHaveValue('Drummer');
  });

  test('/music-professionals?role=&location= hydrates and runs the filtered search once', async ({ page, request }) => {
    const searches: string[] = [];
    const errors = await openPrerendered(
      page,
      request,
      '/music-professionals?role=drummer&location=Mumbai',
      '/music-professionals/index.html',
      (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/public/talent')) searches.push(url.search);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"talent":[],"total":0}' });
      },
    );
    expect(errors).toEqual([]);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toContain('role=drummer');
    expect(searches[0]).toContain('location=Mumbai');
    await expect(page.locator('input[placeholder="City or region"]')).toHaveValue('Mumbai');
  });

  test('/pricing?code= hydrates and opens the promo field with the code', async ({ page, request }) => {
    const errors = await openPrerendered(page, request, '/pricing?code=FEST10&interval=annual', '/pricing/index.html');
    expect(errors).toEqual([]);
    await expect(page.locator('#promo-code')).toHaveValue('FEST10');
  });

  test('/pricing with a promo code kept in sessionStorage hydrates and shows it', async ({ page, request }) => {
    await page.addInitScript(() => sessionStorage.setItem('musilynk_promo_code', 'SAVED5'));
    const errors = await openPrerendered(page, request, '/pricing', '/pricing/index.html');
    expect(errors).toEqual([]);
    await expect(page.locator('#promo-code')).toHaveValue('SAVED5');
  });
});

test('a signed-in visitor with a slow /me and a slow page chunk hydrates once, with one /me call and no signed-out flash', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-token'));
  const html = await (await request.get('/index.html')).text();
  const errors = collectErrors(page);
  let meCalls = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) {
      meCalls += 1;
      await new Promise((r) => setTimeout(r, 1_500));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'u1', name: 'Asha Rao', email: 'asha@example.com', role: 'employer' } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // The route chunk arrives late, so the auth answer lands while the page is still hydrating.
  await page.route(/\/assets\/LandingPage-[^/]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2_500));
    return route.continue();
  });
  await page.route(
    (u) => u.pathname === '/',
    (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
  const signInSeen: boolean[] = [];
  const watcher = setInterval(() => {
    page
      .locator('header a, header button')
      .allTextContents()
      .then((texts) => signInSeen.push(texts.some((t) => /sign in/i.test(t))))
      .catch(() => undefined);
  }, 100);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.getElementById('root')?.dataset.hydrated)).toBe('true');
  await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 15_000 });
  clearInterval(watcher);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
  expect(meCalls).toBe(1);
  expect(signInSeen.some(Boolean)).toBe(false);
});

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
