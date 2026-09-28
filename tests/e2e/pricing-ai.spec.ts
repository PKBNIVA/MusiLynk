import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Mocked-API regression for the public Pricing page's one-line "free AI help" note (the credits
// table and FAQ are gone at launch), and PostJob's "Posting as" identity step (backed by
// /api/me/identities and a persisted acting-as choice).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('Pricing shows the plans and one line about free AI help, with no credits table', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { error: 'Authentication required' }, 401);
    if (path === '/billing/plans')
      return json(route, {
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
        ],
      });
    return json(route, {});
  });

  await page.goto('/pricing');
  await expect(page.getByTestId('pricing-plans')).toBeVisible();
  await expect(page.getByTestId('ai-help-note')).toHaveText(/Includes free AI help to write your profile and job posts\./);
  await expect(page.getByTestId('ai-pricing-section')).toHaveCount(0);
  await expect(page.getByText('credits/mo')).toHaveCount(0);
  await expect(page.getByText('Verse AI Plus')).toHaveCount(0);
  await expect(page.getByText('Top-ups')).toHaveCount(0);

  const axeResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axeResult.violations, axeResult.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual(
    [],
  );
});

test('Pricing still renders the hirer plans if /billing/plans fails to load', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { error: 'Authentication required' }, 401);
    if (path === '/billing/plans') return route.abort();
    return json(route, {});
  });

  await page.goto('/pricing');
  await expect(page.getByTestId('pricing-plans')).toBeVisible();
  await expect(page.getByTestId('ai-help-note')).toBeVisible();
});

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

async function mockPostJob(page: Page, storedActingAs?: string) {
  if (storedActingAs) {
    await page.addInitScript((value) => localStorage.setItem('verse:post-job:posted-as', value), storedActingAs);
  }
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/employer/jobs') return json(route, { jobs: [] });
    if (path === '/me/identities')
      return json(route, {
        identities: [
          { type: 'user', id: 'qa-employer', name: 'QA Employer', key: 'user:qa-employer' },
          { type: 'organization', id: 'org-1', name: 'Bright Sound Studio', key: 'organization:org-1' },
        ],
      });
    return json(route, {});
  });
  await page.goto('/employer/post-job');
}

test('Posting as: an organization identity can be chosen for this job and reviewed at the last step', async ({
  page,
}) => {
  await mockPostJob(page);
  await expect(page.getByLabel('Posting as')).toHaveText(/You, personally/);
  await chooseOption(page.getByLabel('Posting as'), 'Bright Sound Studio');

  await page.getByLabel('Title').fill('Session guitarist');
  await page.getByLabel('Location').fill('Mumbai');
  await page.getByLabel('Location').press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();
  await page.getByLabel(/^Description/).fill('Record layered guitar parts across three sessions with the composer.');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screening & review' }).click();

  await expect(page.getByRole('definition').filter({ hasText: 'Bright Sound Studio' })).toBeVisible();
});

test('Posting as: a persisted acting-as choice preselects on a fresh draft', async ({ page }) => {
  await mockPostJob(page, 'organization:org-1');
  await expect(page.getByLabel('Posting as')).toHaveText(/Bright Sound Studio/);
});
