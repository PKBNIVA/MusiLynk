import { expect, test, type Page } from '@playwright/test';

// The opportunity lists fetch GET /api/jobs one page at a time (limit + cursor) and offer a
// "Load more" button. Mocked API: the fake server pages a fixed list of 5 jobs, 2 at a time.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const me = {
  id: 'qa-seeker',
  name: 'Asha Rao',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
const job = (n: number) => ({
  id: `job-${n}`,
  title: `Session Bassist ${n}`,
  company: 'MusiLynk Studio',
  location: 'Mumbai',
  workplace: 'onsite',
  type: 'Contract',
  opportunity_kind: 'gig',
  genre: 'Film',
  skills: ['Bass'],
  applicationsCount: 0,
  saved: false,
});
const ALL = [1, 2, 3, 4, 5].map(job);
const PAGE = 2;

type Options = { signedIn: boolean; failCursor?: string };

/** Serves /api/jobs in pages of PAGE and records every query string it was asked for. */
async function mockJobs(page: Page, { signedIn, failCursor }: Options) {
  const queries: URLSearchParams[] = [];
  let failed = false;
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
    if (url.pathname.endsWith('/me')) return signedIn ? reply(200, { user: me }) : reply(401, { error: 'Sign in' });
    if (!url.pathname.endsWith('/api/jobs')) return reply(200, {});
    queries.push(url.searchParams);
    const cursor = url.searchParams.get('cursor');
    if (cursor && cursor === failCursor && !failed) {
      failed = true;
      return reply(500, { error: 'The server is busy. Try again.' }); // 5xx other than 502-504 is not retried by the client
    }
    const start = cursor ? Number(cursor) : 0;
    const slice = ALL.slice(start, start + PAGE);
    const next = start + PAGE < ALL.length ? String(start + PAGE) : null;
    return reply(200, { jobs: slice, nextCursor: next, total: ALL.length });
  });
  return queries;
}

const titles = (page: Page) => page.getByRole('heading', { level: 2, name: /Session Bassist/ });

test('job search loads more opportunities, keeps the filters and moves focus to the new results', async ({ page }) => {
  const queries = await mockJobs(page, { signedIn: true });
  await page.goto('/jobseeker/jobs');
  await expect(page.getByText('5 opportunities · all cities · all formats')).toBeVisible();
  await expect(titles(page)).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: 'Showing 2 of 5 opportunities' })).toBeVisible();

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('checkbox').first().click(); // Paid only
  await expect.poll(() => queries.some((q) => q.get('paid') === 'true')).toBe(true);
  await expect(titles(page)).toHaveCount(2);

  const loadMore = page.getByRole('button', { name: 'Load more opportunities' });
  await loadMore.click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page.getByText('Showing 4 of 5 opportunities')).toBeVisible();
  const second = queries.at(-1)!;
  expect(second.get('cursor')).toBe('2');
  expect(second.get('paid')).toBe('true');
  // Keyboard users continue at the first new result.
  await expect(page.locator('[data-job-item="2"]')).toBeFocused();

  await loadMore.click();
  await expect(titles(page)).toHaveCount(5);
  await expect(page.getByText('Showing 5 of 5 opportunities')).toBeVisible();
  await expect(loadMore).toHaveCount(0);
});

test('a failed "load more" keeps the list and can be retried', async ({ page }) => {
  await mockJobs(page, { signedIn: true, failCursor: '2' });
  await page.goto('/jobseeker/jobs');
  await expect(titles(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Load more opportunities' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The server is busy' })).toBeVisible();
  await expect(titles(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page.getByRole('alert').filter({ hasText: 'The server is busy' })).toHaveCount(0);
});

test('public music jobs page pages through results and a new search starts over', async ({ page }) => {
  const queries = await mockJobs(page, { signedIn: false });
  await page.goto('/music-jobs');
  await expect(titles(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Load more opportunities' }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page.locator('[data-job-item="2"]')).toBeFocused();
  expect(queries.at(-1)!.get('cursor')).toBe('2');

  await page.getByRole('button', { name: 'Gigs' }).click();
  await expect.poll(() => queries.at(-1)!.get('kind')).toBe('gig');
  expect(queries.at(-1)!.get('cursor')).toBeNull();
  await expect(titles(page)).toHaveCount(2);
  await expect(page.getByText('Showing 2 of 5 opportunities')).toBeVisible();
});
