import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Mocked-API regression for the public "Verse AI" pricing section, and PostJob's "Posting as"
// identity step (backed by /api/me/identities and a persisted acting-as choice).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('Pricing shows the Verse AI plans, the cost table and the FAQ lines', async ({ page }) => {
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
    if (path === '/ai/pricing')
      return json(route, {
        freeCreditsPerMonth: 20,
        aiPlus: { planCode: 'ai_plus', priceInr: 199, creditsPerMonth: 400 },
        planAllowances: { pro: 500, studio: 2000, enterprise: null },
        topups: { small: { priceInr: 99, credits: 150 }, large: { priceInr: 399, credits: 700 } },
        topupExpiresAfterMonths: 12,
        taskCosts: { profile_headline: 1, job_description: 3 },
      });
    return json(route, {});
  });

  await page.goto('/pricing');
  const section = page.getByTestId('ai-pricing-section');
  await expect(section).toBeVisible();
  await expect(section.getByText('20 credits/mo')).toBeVisible();
  await expect(section.getByText('₹199')).toBeVisible();
  await expect(section.getByText('400 credits/month')).toBeVisible();
  await expect(section.getByText('₹99 for 150 credits')).toBeVisible();
  await expect(section.getByText('₹399 for 700 credits')).toBeVisible();
  await expect(section.getByText('Short help')).toBeVisible();
  await expect(section.getByText('Long writing')).toBeVisible();
  await expect(section.getByText('Charged only on success', { exact: true })).toBeVisible();
  await expect(section.getByText('Monthly credits reset every billing period')).toBeVisible();
  await expect(section.getByText('Top-ups last 12 months')).toBeVisible();

  const axeResult = await new AxeBuilder({ page })
    .include('[data-testid="ai-pricing-section"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axeResult.violations, axeResult.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual(
    [],
  );
});

test('Pricing still renders the hirer plans and hides the AI section if pricing fails to load', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { error: 'Authentication required' }, 401);
    if (path === '/billing/plans') return route.abort();
    if (path === '/ai/pricing') return route.abort();
    return json(route, {});
  });

  await page.goto('/pricing');
  await expect(page.getByTestId('pricing-plans')).toBeVisible();
  await expect(page.getByTestId('ai-pricing-section')).toHaveCount(0);
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
