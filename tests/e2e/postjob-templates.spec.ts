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

  await page.getByLabel('Location').fill('Mumbai');
  await page.getByLabel('Location').press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screening & review' }).click();

  await expect(page.getByLabel('Screening questions')).toHaveValue(/Can you read charts/);
});

test('picking a different template replaces the previous one\'s content', async ({ page }) => {
  await mockPostJob(page);
  await page.getByRole('button', { name: 'Studio session' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Session musician for a studio recording');

  await page.getByRole('button', { name: 'Teaching' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Music teacher / instructor');
});
