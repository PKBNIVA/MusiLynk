import { expect, test, type Page } from '@playwright/test';

// Opportunity pages show deadlines and pay in a readable Indian format ("Apply by 11 Nov 2026 ·
// in 44 days", "₹15,000–35,000") instead of raw ISO strings and ungrouped numbers (SRCH-12, FORM-07).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const ISO_DEADLINE = '2026-11-11T12:00:00.000Z';
const job = {
  id: 'job-1',
  employer_id: 'emp-1',
  title: 'Violinist for a destination wedding',
  company: 'MusiLynk Weddings',
  location: 'Goa',
  workplace: 'hybrid',
  function_area: 'Performance',
  type: 'Contract',
  kind: 'gig',
  opportunity_kind: 'gig',
  genre: 'Classical',
  currency: 'INR',
  compensation_min: 15000,
  compensation_max: 35000,
  application_deadline: ISO_DEADLINE,
  start_date: '2026-12-15',
  skills: ['Violin'],
  languages: [],
  screening_questions: [],
  status: 'published',
  applicationsCount: 3,
  saved: false,
};

async function mockApi(page: Page, signedIn: boolean) {
  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));
  if (signedIn) {
    await page.addInitScript(() => {
      localStorage.setItem('musilynk_access_token', 'qa-token');
      localStorage.setItem('musilynk-tour-v2-jobseeker', 'done');
    });
  }
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/me'))
      return signedIn
        ? reply(200, {
            user: {
              id: 'qa',
              name: 'Asha',
              email: 'qa@example.invalid',
              role: 'jobseeker',
              status: 'active',
              profileComplete: true,
            },
          })
        : reply(401, { error: 'Sign in' });
    if (url.pathname.endsWith('/api/jobs/job-1')) return reply(200, { job });
    if (url.pathname.endsWith('/api/jobs')) return reply(200, { jobs: [job], nextCursor: null, total: 1 });
    return reply(200, {});
  });
}

test('public opportunity shows a formatted deadline, start date and pay', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/opportunities/job-1');
  const main = page.getByRole('main');
  await expect(main).toContainText('Apply by 11 Nov 2026 · in 44 days');
  await expect(main).toContainText('Starts 15 Dec 2026');
  await expect(main).toContainText('₹15,000–35,000');
  await expect(main).toContainText('Performance');
  await expect(main).not.toContainText(ISO_DEADLINE);
});

test('signed-in job detail shows a formatted deadline and start date', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/jobseeker/jobs/job-1');
  const main = page.getByRole('main');
  await expect(main).toContainText('Apply by 11 Nov 2026 · in 44 days');
  await expect(main).toContainText('15 Dec 2026');
  await expect(main).toContainText('₹15,000–35,000');
  await expect(main).not.toContainText('2026-12-15');
});

test('job cards show the closing date on public and signed-in lists', async ({ page }) => {
  await mockApi(page, false);
  await page.goto('/music-jobs');
  await expect(page.locator('[data-job-deadline]').first()).toHaveText('Closes 11 Nov 2026 · in 44 days');
  await expect(page.getByRole('main')).toContainText('₹15,000–35,000');
});

test('signed-in job cards show the closing date', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/jobseeker/jobs');
  await expect(page.locator('[data-job-deadline]').first()).toHaveText('Closes 11 Nov 2026 · in 44 days');
});

test('native date and time inputs are echoed in Indian order beside the field', async ({ page }) => {
  await mockApi(page, true);
  await page.route('**/api/availability', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ windows: [] }) }),
  );
  await page.goto('/jobseeker/availability');
  const start = page.getByLabel(/^Start/);
  await start.fill('2026-11-14T18:00');
  await expect(page.getByText('14 Nov 2026, 6 pm', { exact: true })).toBeVisible();
  const end = page.getByLabel(/^End/);
  await end.fill('2026-11-14T21:30');
  await expect(page.getByText('14 Nov 2026, 9:30 pm', { exact: true })).toBeVisible();
  await start.fill('');
  await expect(page.getByText('14 Nov 2026, 6 pm', { exact: true })).toHaveCount(0);
});
