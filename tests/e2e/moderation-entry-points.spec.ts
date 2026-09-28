import { expect, test, type Page, type Route } from '@playwright/test';

// New report entry points (public profile, public act, review card). Admin content-moderation
// actions are covered separately in admin-content-moderation.spec.ts (runs on the admin build).
// Mocked-API only; the real endpoints are covered by backend/test/integration/reports_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const professional = {
  id: 'user-talent-1',
  name: 'Nina Guitarist',
  role: 'jobseeker',
  headline: 'Session guitarist',
  bio: 'Plays everything from jazz to rock.',
  location: 'Bengaluru',
  roles: [],
  instruments: ['Guitar'],
  credits: [],
};

const act = {
  id: 'act-1',
  name: 'The Night Owls',
  act_type: 'Band',
  currency: 'INR',
  fee_basis: 'event',
  bio: 'A four-piece indie band.',
  genres: [],
  members: [],
};

async function reportState(page: Page) {
  const state = { reports: [] as Record<string, unknown>[] };
  await page.route('**/api/reports', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    state.reports.push(route.request().postDataJSON());
    return json(route, { id: 'rep-new' }, 201);
  });
  return state;
}

test.describe('public entry points', () => {
  test('an anonymous visitor is prompted to sign in before reporting a profile or act', async ({ page }) => {
    await page.route('**/api/public/talent/user-talent-1', (route) => json(route, { professional, portfolio: [] }));
    await page.goto('/professionals/user-talent-1');
    await expect(page.getByRole('link', { name: 'Sign in to report this profile' })).toBeVisible();

    await page.route('**/api/public/acts/act-1', (route) => json(route, { act }));
    await page.goto('/acts/act-1');
    await expect(page.getByRole('link', { name: 'Sign in to report this act' })).toBeVisible();
  });

  test('a signed-in employer can report a candidate profile', async ({ page }) => {
    const state = await reportState(page);
    await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
    await page.route('**/api/me', (route) =>
      json(route, {
        user: { id: 'emp-1', name: 'Studio Co', role: 'employer', status: 'active', profileComplete: true },
      }),
    );
    await page.route('**/api/public/talent/user-talent-1', (route) => json(route, { professional, portfolio: [] }));
    await page.goto('/professionals/user-talent-1');
    await page.getByRole('button', { name: 'Report profile' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this profile' });
    await dialog.getByRole('radio', { name: 'Harassment' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    expect(state.reports).toEqual([{ entityType: 'user', entityId: 'user-talent-1', reason: 'Harassment' }]);
  });

  test('a signed-in employer can report a bookable act', async ({ page }) => {
    const state = await reportState(page);
    await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
    await page.route('**/api/me', (route) =>
      json(route, {
        user: { id: 'emp-1', name: 'Studio Co', role: 'employer', status: 'active', profileComplete: true },
      }),
    );
    await page.route('**/api/public/acts/act-1', (route) => json(route, { act }));
    await page.goto('/acts/act-1');
    await page.getByRole('button', { name: 'Report act' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this act' });
    await dialog.getByRole('radio', { name: 'Spam or scam' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    expect(state.reports).toEqual([{ entityType: 'act', entityId: 'act-1', reason: 'Spam or scam' }]);
  });

  test('a signed-in user can report a review on the reviews page', async ({ page }) => {
    const state = await reportState(page);
    await page.addInitScript(() => {
      localStorage.setItem('verse_access_token', 'qa-token');
      localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    });
    await page.route('**/api/me', (route) =>
      json(route, {
        user: { id: 'js-1', name: 'Asha Rao', role: 'jobseeker', status: 'active', profileComplete: true },
      }),
    );
    await page.route('**/api/reviews', (route) =>
      json(route, {
        reviews: [
          {
            id: 'rev-1',
            employerName: 'Loud Studio',
            authorName: 'Someone Else',
            rating: 1,
            body: 'Fabricated one-star review.',
            status: 'published',
          },
        ],
        eligibleEmployers: [],
      }),
    );
    await page.goto('/jobseeker/reviews');
    await page.getByRole('button', { name: 'Report review by Someone Else' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this review' });
    await dialog.getByRole('radio', { name: 'Spam or scam' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    expect(state.reports).toEqual([{ entityType: 'review', entityId: 'rev-1', reason: 'Spam or scam' }]);
  });
});
