import { expect, test, type Page, type Route } from '@playwright/test';

// "Start from a template" on PostJob's first step — six no-network, no-AI templates that prefill
// title, description and screening questions. AI status is mocked disabled throughout, since the
// template picker works the same regardless of whether AI is enabled.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockPostJob(page: Page) {
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.addInitScript(() => localStorage.removeItem('verse:post-job:posted-as'));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/employer/jobs') return json(route, { jobs: [] });
    if (path === '/me/identities') return json(route, { identities: [] });
    return json(route, {});
  });
  await page.goto('/employer/post-job');
}

test('shows six templates, one per opportunity type', async ({ page }) => {
  await mockPostJob(page);
  const group = page.getByRole('group', { name: 'Opportunity templates' });
  await expect(group).toBeVisible();
  await expect(group.getByRole('button')).toHaveCount(6);
  await expect(group.getByRole('button', { name: 'Studio session' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Wedding / event gig' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Tour' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Jingle / ad' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'OTT / film score' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Teaching' })).toBeVisible();
});

test('picking a template prefills title, description and screening questions', async ({ page }) => {
  await mockPostJob(page);
  await page.getByRole('button', { name: 'Studio session' }).click();

  await expect(page.getByLabel('Title')).toHaveValue('Session musician for a studio recording');
  await expect(page.getByLabel(/^Description/)).toContainText('We are recording');

  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screening & review' }).click();

  await expect(page.getByLabel('Screening questions')).toHaveValue(/Can you read charts/);
});

test("picking a different template replaces the previous one's content", async ({ page }) => {
  await mockPostJob(page);
  await page.getByRole('button', { name: 'Studio session' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Session musician for a studio recording');

  await page.getByRole('button', { name: 'Teaching' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Music teacher / instructor');
});

// V-14: a Free hirer publishing a second active listing sees a dialog, not a toast, and the
// work is saved as a draft without navigating away.
test('a 402 plan limit on publish opens the plan-limit dialog instead of a toast, and keeps the work as a draft', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.addInitScript(() => localStorage.removeItem('verse:post-job:posted-as'));
  let jobsPosts = 0;
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/employer/jobs') return json(route, { jobs: [] });
    if (path === '/me/identities') return json(route, { identities: [] });
    if (path === '/jobs' && method === 'POST') {
      jobsPosts += 1;
      if (jobsPosts === 1)
        return json(
          route,
          {
            error: 'Your plan allows 1 active opportunity. Close one or upgrade your plan to continue.',
            code: 'PLAN_LIMIT',
          },
          402,
        );
      // The draft-save retry that follows the 402.
      return json(route, { id: 'job-new', status: 'draft', postedAs: null }, 201);
    }
    return json(route, {});
  });
  await page.goto('/employer/post-job');

  await page.getByRole('button', { name: 'Studio session' }).click();
  await page.getByLabel('Location').fill('Mumbai');
  await page.getByLabel('Location').press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screening & review' }).click();
  await page.getByRole('button', { name: 'Submit for review' }).click();

  const dialog = page.getByTestId('plan-limit-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("You've reached your plan's limit");
  await expect(dialog).toContainText(
    'Your plan allows 1 active opportunity. Close one or upgrade your plan to continue.',
  );
  await expect(dialog).toContainText('We saved this opportunity as a draft.');
  await expect(dialog.getByRole('button', { name: 'See plans' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close another listing' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep as draft' })).toBeVisible();
  // No navigation until a button is clicked.
  await expect(page).toHaveURL(/\/employer\/post-job$/);
  expect(jobsPosts).toBe(2);

  await dialog.getByRole('button', { name: 'See plans' }).click();
  await expect(page).toHaveURL(/\/employer\/billing$/);
});
