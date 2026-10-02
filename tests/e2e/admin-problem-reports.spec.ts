import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage of the admin "Problem reports" tab (Admin::ProblemReportsController).
// The real endpoints, including the admin-only signed screenshot link, are covered by
// backend/test/integration/problem_reports_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
type Report = Record<string, unknown> & { id: string; status: string; adminNote: string | null };
const baseReport: Report = {
  id: 'prob_1',
  status: 'new',
  description: 'The save button spins forever on my profile.',
  expected: 'My changes to be saved.',
  page: '/jobseeker/profile',
  context: {
    release: 'abc1234',
    browser: 'Chrome 130',
    os: 'Android 14',
    viewport: { width: 390, height: 844 },
    role: 'jobseeker',
    errors: ['TypeError: x is undefined'],
  },
  email: null,
  hasScreenshot: true,
  adminNote: null,
  createdAt: '2026-10-02T06:00:00Z',
  handledAt: null,
  handledByName: null,
  user: { id: 'u1', name: 'Asha Rao', email: 'asha@example.invalid', role: 'jobseeker' },
};
const signedOut: Report = {
  ...baseReport,
  id: 'prob_2',
  description: 'Pricing page is blank.',
  expected: null,
  hasScreenshot: false,
  email: 'visitor@example.com',
  user: null,
  context: {},
  page: null,
};

async function openAdmin(page: Page, url = '/admin?tab=problems') {
  const state = { patches: [] as Record<string, unknown>[], shotViews: 0, lists: [] as string[] };
  const reports = [{ ...baseReport }, { ...signedOut }];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const { pathname, search } = new URL(req.url());
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (pathname === '/api/admin/stats') return json(route, { stats: { openReports: 0, newProblemReports: 2 } });
    if (pathname === '/api/admin/problem-reports' && req.method() === 'GET') {
      state.lists.push(search);
      const wanted = new URLSearchParams(search).get('status');
      const rows = reports.filter((r) => !wanted || r.status === wanted);
      const count = (s: string) => reports.filter((r) => r.status === s).length;
      return json(route, {
        reports: rows,
        counts: { new: count('new'), triaged: count('triaged'), resolved: count('resolved') },
        page: 1,
        perPage: 50,
        total: rows.length,
      });
    }
    const detail = /^\/api\/admin\/problem-reports\/(prob_\d)(\/screenshot)?$/.exec(pathname);
    if (detail) {
      const report = reports.find((r) => r.id === detail[1])!;
      if (detail[2]) {
        state.shotViews += 1;
        return json(route, {
          url: 'http://127.0.0.1/fake-shot.png',
          contentType: 'image/png',
          expiresAt: '2026-10-02T06:05:00Z',
        });
      }
      if (req.method() === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        state.patches.push(body);
        if (body.status) report.status = body.status as string;
        if ('adminNote' in body) report.adminNote = body.adminNote as string;
        return json(route, { ok: true, report });
      }
      return json(route, { report });
    }
    return json(route, {});
  });
  await page.route('http://127.0.0.1/fake-shot.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await page.goto(url);
  return state;
}

test('the Problem reports tab lists new reports, filters by status and shows who sent each', async ({ page }) => {
  const state = await openAdmin(page);
  await expect(page.getByRole('tab', { name: 'Problem reports (2)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('The save button spins forever on my profile.')).toBeVisible();
  await expect(page.getByText('Pricing page is blank.')).toBeVisible();
  await expect(page.getByText('Asha Rao (asha@example.invalid)')).toBeVisible();
  await expect(page.getByText('visitor@example.com (signed out)')).toBeVisible();
  expect(state.lists[0]).toContain('status=new');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: /^Resolved/ }).click();
  await expect(page.getByText('No problem reports match this filter.')).toBeVisible();
});

test('opening a report shows the screenshot only on request, and status and note changes are saved', async ({
  page,
}) => {
  const state = await openAdmin(page);
  await page.getByRole('button', { name: /Open problem report from Asha Rao/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Problem report' });
  await expect(dialog.getByText('My changes to be saved.')).toBeVisible();
  await expect(dialog.getByText('Chrome 130, Android 14')).toBeVisible();
  await expect(dialog.getByText('TypeError: x is undefined')).toBeVisible();

  // No signed link is fetched until the admin asks for the screenshot.
  expect(state.shotViews).toBe(0);
  await expect(dialog.getByRole('img', { name: 'Screenshot attached to this report' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Show screenshot' }).click();
  const image = dialog.getByRole('img', { name: 'Screenshot attached to this report' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  expect(state.shotViews).toBe(1);

  await dialog.getByLabel('Your note (only admins see this)').fill('Reproduced on Android.');
  await dialog.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Note saved')).toBeVisible();

  await dialog.getByRole('button', { name: 'Mark triaged' }).click();
  await expect(dialog.getByRole('button', { name: 'Mark triaged' })).toBeDisabled();
  expect(state.patches).toEqual([{ adminNote: 'Reproduced on Android.' }, { status: 'triaged' }]);
});

test('a founder email link opens that report directly, and a report without a screenshot offers none', async ({
  page,
}) => {
  await openAdmin(page, '/admin?tab=problems&report=prob_2');
  const dialog = page.getByRole('dialog', { name: 'Problem report' });
  await expect(dialog.getByText('Pricing page is blank.')).toBeVisible();
  await expect(dialog.getByText('visitor@example.com (signed out)')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Show screenshot' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});
