import { expect, test, type Page, type Route } from '@playwright/test';

// "Start from a template" on PostJob's last step (Screen & review) — six no-network, no-AI templates that prefill
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

// The template chips live on the last step, so reach it with a title and a city.
async function toReview(page: Page) {
  await page.getByLabel('Title').fill('Session player');
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();
}

test('shows six templates, one per opportunity type', async ({ page }) => {
  await mockPostJob(page);
  await toReview(page);
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

test('picking a template prefills description and screening questions and keeps the typed title', async ({ page }) => {
  await mockPostJob(page);
  await toReview(page);
  await page.getByRole('button', { name: 'Studio session' }).click();

  await expect(page.getByLabel(/^Description/)).toHaveValue(/We are recording/);
  await expect(page.getByLabel('Screening questions')).toHaveValue(/Can you read charts/);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Session player');
});

// J-02: the template's {{placeholders}} are highlighted and block submit until they are replaced.
test('a template leaves highlighted placeholders that block submit until replaced', async ({ page }) => {
  await mockPostJob(page);
  await toReview(page);
  await page.getByRole('button', { name: 'Studio session' }).click();

  const notice = page.getByRole('status').filter({ hasText: 'still to fill in' });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: '{{project/album name}}' })).toBeVisible();
  // Choosing a placeholder selects it in the field so it can be typed over.
  await notice.getByRole('button', { name: '{{project/album name}}' }).click();
  await expect(page.getByLabel(/^Description/)).toBeFocused();

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Fill in each highlighted spot with real details.').first()).toBeVisible();

  await page
    .getByLabel(/^Description/)
    .fill('We are recording a Hindi indie EP in Andheri and need a session drummer for three days of tracking.');
  await page.getByLabel('Screening questions').fill('Can you read charts?');
  await expect(notice).toHaveCount(0);
});

test("picking a different template replaces the previous one's content", async ({ page }) => {
  await mockPostJob(page);
  await toReview(page);
  await page.getByRole('button', { name: 'Studio session' }).click();
  await expect(page.getByLabel(/^Description/)).toHaveValue(/We are recording/);

  await page.getByRole('button', { name: 'Teaching' }).click();
  await expect(page.getByLabel(/^Description/)).toHaveValue(/is looking for a/);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Session player');
});

// V-14: a Free hirer publishing a second active listing sees a dialog, not a toast, and the
// work is saved as a draft without navigating away.
test('a 402 plan limit on publish opens the plan-limit dialog instead of a toast, and keeps the work as a draft', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.addInitScript(() => localStorage.removeItem('verse:post-job:posted-as'));
  let jobsPosts = 0;
  let submitted = 0;
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/employer/jobs') return json(route, { jobs: [] });
    if (path === '/me/identities') return json(route, { identities: [] });
    // Every step change saves the draft, so the submission is a PATCH of it.
    if (path === '/jobs' && method === 'POST') {
      jobsPosts += 1;
      return json(route, { id: 'job-new', status: 'draft', postedAs: null }, 201);
    }
    if (path === '/employer/jobs/job-new' && method === 'PATCH') {
      const body = route.request().postDataJSON() as { status?: string };
      if (body.status === 'pending') {
        submitted += 1;
        return json(
          route,
          {
            error: 'Your plan allows 1 active opportunity. Close one or upgrade your plan to continue.',
            code: 'PLAN_LIMIT',
          },
          402,
        );
      }
      return json(route, { ok: true, job: { id: 'job-new', status: 'draft' } });
    }
    return json(route, {});
  });
  await page.goto('/employer/post-job');

  await toReview(page);
  await page.getByRole('button', { name: 'Studio session' }).click();
  await page
    .getByLabel(/^Description/)
    .fill('We are recording a Hindi indie EP in Andheri and need a session drummer for three days of tracking.');
  await page.getByLabel('Screening questions').fill('Can you read charts?');
  await page.getByRole('button', { name: 'Submit for review' }).click();

  const dialog = page.getByTestId('plan-limit-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("You've reached your plan's limit");
  await expect(dialog).toContainText(
    'Your plan allows 1 active opportunity. Close one or upgrade your plan to continue.',
  );
  await expect(dialog).toContainText('We saved this opportunity as a draft.');
  await expect(dialog.getByRole('button', { name: 'See plans' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close another opportunity' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep as draft' })).toBeVisible();
  // No navigation until a button is clicked.
  await expect(page).toHaveURL(/\/employer\/post-job$/);
  expect(jobsPosts).toBe(1);
  expect(submitted).toBe(1);

  await dialog.getByRole('button', { name: 'See plans' }).click();
  await expect(page).toHaveURL(/\/employer\/billing$/);
});
