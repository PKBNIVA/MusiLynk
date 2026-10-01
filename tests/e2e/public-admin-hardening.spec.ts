import { expect, test } from '@playwright/test';
import { mockApi } from './mock-api';

// Mocked-API regressions for the public funnel (the admin console's are in admin-console.spec.ts).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'emp-1',
  name: 'QA Studio',
  email: 'studio@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

test.describe('public funnel', () => {
  test('pricing shows the plan limits the API enforces and falls back when it is down', async ({ page }) => {
    await mockApi(page, {
      '/api/billing/plans': {
        body: {
          plans: [
            {
              code: 'free',
              name: 'Free',
              monthly: 0,
              trialDays: 0,
              activePosts: 1,
              seats: 1,
              shortlist: 20,
              bookings: 2,
            },
            {
              code: 'pro',
              name: 'Pro',
              monthly: 3100,
              trialDays: 7,
              activePosts: 12,
              seats: 3,
              shortlist: 300,
              bookings: 25,
            },
          ],
        },
      },
    });
    await page.goto('/pricing');
    const plans = page.getByTestId('pricing-plans');
    await expect(plans).toContainText('₹3,100');
    await expect(plans).toContainText('7-day free trial');
    await expect(plans).toContainText('12 active opportunities');
    await expect(plans).not.toContainText('₹2,499');
    await expect(page).toHaveTitle(/Pricing/);
  });

  test('pricing still renders plans when /billing/plans fails', async ({ page }) => {
    await mockApi(page, { '/api/billing/plans': { status: 503, body: { error: 'down' } } });
    await page.goto('/pricing');
    await expect(page.getByTestId('pricing-plans')).toContainText('₹2,499');
    await expect(page.getByRole('status')).toContainText('standard plan limits');
  });

  const act = { id: 'act-1', name: 'The QA Trio', act_type: 'band', genres: ['Jazz'], members: [], currency: 'INR' };

  test('an act page carries the act into the booking flow', async ({ page }) => {
    await mockApi(page, { '/api/public/acts/act-1': { body: { act } } }, employer);
    await page.goto('/acts/act-1');
    await expect(page.getByRole('link', { name: 'Request a quote' })).toHaveAttribute(
      'href',
      '/employer/book-talent?act=act-1',
    );
    await expect(page).toHaveTitle(/The QA Trio/);
  });

  test('anonymous visitors are sent to sign in with the act remembered', async ({ page }) => {
    await mockApi(page, { '/api/public/acts/act-1': { body: { act } } });
    await page.goto('/acts/act-1');
    await page.getByRole('link', { name: 'Sign in to request a quote' }).click();
    await expect(page).toHaveURL(/\/auth\/employer/);
    const from = await page.evaluate(() => (history.state as { usr?: { from?: unknown } } | null)?.usr?.from);
    expect(from).toBe('/employer/book-talent?act=act-1');
  });

  for (const [path, endpoint, back] of [
    ['/acts/missing', '/api/public/acts/missing', 'Browse bookable acts'],
    ['/professionals/missing', '/api/public/talent/missing', 'Browse musicians'],
    ['/opportunities/missing', '/api/jobs/missing', 'Browse music jobs'],
  ] as const) {
    test(`${path} explains a missing record instead of offering a useless retry`, async ({ page }) => {
      await mockApi(page, { [endpoint]: { status: 404, body: { error: 'Not found' } } });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('isn’t available');
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: back })).toBeVisible();
      await expect(page).toHaveTitle(/not found/i);
    });
  }

  test('verify-email without a token does not call the API', async ({ page }) => {
    const calls = await mockApi(page, {});
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('couldn’t verify');
    expect(calls.some((call) => call.path === '/api/auth/verify-email')).toBe(false);
  });

  test('verify-email sends a token exactly once', async ({ page }) => {
    const calls = await mockApi(page, { 'POST /api/auth/verify-email': { body: { ok: true } } });
    await page.goto('/verify-email?token=abc');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Email verified');
    expect(calls.filter((call) => call.path === '/api/auth/verify-email').map((call) => call.body)).toEqual([
      { token: 'abc' },
    ]);
  });

  test('public pages have their own titles and descriptions', async ({ page }) => {
    await mockApi(page, {
      '/api/jobs': { body: { jobs: [] } },
      '/api/public/talent': { body: { talent: [] } },
      '/api/public/acts': { body: { acts: [] } },
    });
    const seen = new Set<string>();
    for (const path of [
      '/forgot-password',
      '/reset-password',
      '/pricing',
      '/start',
      '/guide',
      '/search',
      '/sitemap',
      '/music-jobs',
      '/music-professionals',
      '/book-music',
      '/terms',
      '/contact',
      '/nowhere',
    ]) {
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page).not.toHaveTitle('Verse — Music Careers, Hiring & Booking');
      const title = await page.title();
      expect(title, path).toMatch(/Verse/);
      expect(seen.has(title), `${path} reuses title "${title}"`).toBe(false);
      seen.add(title);
      expect(await page.locator('meta[name="description"]').getAttribute('content'), path).toBeTruthy();
    }
  });

  test('search keeps working when browser storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'setItem', {
        value: () => {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await mockApi(page, {
      '/api/search': {
        body: {
          results: [{ type: 'talent', id: 'u-1', url: '/professionals/u-1', title: 'Asha Rao', tags: [] }],
          interpretedAs: ['singer'],
        },
      },
    });
    await page.goto('/search?q=singer');
    await expect(page.getByText('Asha Rao')).toBeVisible();
    await expect(page.getByText('Search is taking a breather')).toHaveCount(0);
  });
});
