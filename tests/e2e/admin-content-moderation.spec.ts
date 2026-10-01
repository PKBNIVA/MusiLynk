import { expect, test, type Page, type Route } from '@playwright/test';

// Admin content-moderation decisions (unpublish job / hide review / hide act) on the admin
// site (VITE_APP_TARGET=admin, see playwright.config.ts adminSpecs). The real endpoints are
// covered by backend/test/integration/report_moderation_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

async function openAdminReports(
  page: Page,
  report: Record<string, unknown>,
  context: { report: Record<string, unknown>; [k: string]: unknown },
) {
  const state = { moderated: [] as unknown[], report: { ...report, status: 'open' } };
  const dashboard: Record<string, unknown> = {
    '/api/admin/stats': { stats: { openReports: 1 } },
    '/api/admin/users': { users: [] },
    '/api/admin/jobs': { jobs: [] },
    '/api/admin/reviews': { reviews: [] },
    '/api/admin/verifications': { requests: [] },
    '/api/admin/audit': { logs: [] },
    '/api/admin/subscriptions': { subscriptions: [] },
    '/api/admin/bookings': { bookings: [] },
  };
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (pathname === '/api/admin/reports')
      return json(route, {
        reports: state.report.status === 'open' ? [state.report] : [],
        total: state.report.status === 'open' ? 1 : 0,
        page: 1,
        perPage: 50,
      });
    if (pathname === '/api/admin/reports/rep-1/context') return json(route, context);
    if (pathname === '/api/admin/reports/rep-1/moderate' && route.request().method() === 'POST') {
      state.moderated.push(route.request().postDataJSON());
      state.report.status = 'resolved';
      return json(route, { ok: true, report: { ...context.report, status: 'resolved' }, resolvedReportIds: ['rep-1'] });
    }
    return json(route, dashboard[pathname] ?? {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: /Reports/ }).click();
  return state;
}

test('unpublish job asks for confirmation, then closes the report', async ({ page }) => {
  const report = {
    id: 'rep-1',
    status: 'open',
    entity_type: 'job',
    entity_id: 'job-1',
    reason: 'Misleading opportunity',
    created_at: '2026-09-01T00:00:00Z',
    reporterName: 'Asha',
  };
  const context = {
    report: {
      id: 'rep-1',
      entityType: 'job',
      entityId: 'job-1',
      reason: 'Misleading opportunity',
      status: 'open',
      createdAt: '2026-09-01T00:00:00Z',
      reporterId: 'r1',
      reporterName: 'Asha',
    },
    reportedUser: {
      id: 'emp-1',
      name: 'Loud Studio',
      email: 'studio@example.invalid',
      role: 'employer',
      status: 'active',
    },
    history: {
      reportsTotal: 1,
      reportsLast90Days: 1,
      openReports: 0,
      warnings: 0,
      suspensions: 0,
      flaggedMessagesLast90Days: 0,
    },
    conversation: null,
    guidelinesUrl: '/community-guidelines',
  };
  const state = await openAdminReports(page, report, context);
  await page.getByRole('button', { name: `Review report: ${report.reason}` }).click();
  const review = page.getByTestId('report-review');
  await review.getByTestId('choose-unpublish_job').click();
  await expect(review).toContainText('Removes the listing from search');
  await review.getByTestId('confirm-decision').click();
  await expect(page.getByText('Job unpublished and reports resolved')).toBeVisible();
  expect(state.moderated).toEqual([{ decision: 'unpublish_job' }]);
});

test('hide review is only offered for a review report', async ({ page }) => {
  const report = {
    id: 'rep-1',
    status: 'open',
    entity_type: 'review',
    entity_id: 'rev-1',
    reason: 'Harassment',
    created_at: '2026-09-01T00:00:00Z',
    reporterName: 'Loud Studio',
  };
  const context = {
    report: {
      id: 'rep-1',
      entityType: 'review',
      entityId: 'rev-1',
      reason: 'Harassment',
      status: 'open',
      createdAt: '2026-09-01T00:00:00Z',
      reporterId: 'r1',
      reporterName: 'Loud Studio',
    },
    reportedUser: null,
    history: null,
    conversation: null,
    guidelinesUrl: '/community-guidelines',
  };
  const state = await openAdminReports(page, report, context);
  await page.getByRole('button', { name: `Review report: ${report.reason}` }).click();
  const review = page.getByTestId('report-review');
  await expect(review.getByTestId('choose-hide_review')).toBeVisible();
  await expect(review.getByRole('button', { name: 'Warn' })).toBeDisabled();
  await review.getByTestId('choose-hide_review').click();
  await review.getByTestId('confirm-decision').click();
  await expect(page.getByText('Review hidden and reports resolved')).toBeVisible();
  expect(state.moderated).toEqual([{ decision: 'hide_review' }]);
});

test('report filters show "All" until a value is chosen, and can go back to All', async ({ page }) => {
  const report = {
    id: 'rep-1',
    status: 'open',
    entity_type: 'job',
    entity_id: 'job-1',
    reason: 'Spam',
    created_at: '2026-09-01T00:00:00Z',
    reporterName: 'Loud Studio',
  };
  const requested: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/admin/reports') requested.push(url.searchParams.get('entityType') ?? '');
  });
  await openAdminReports(page, report, { report: { id: 'rep-1' } });
  const entity = page.locator('#report-filter-entity');
  await expect(entity).toHaveText(/All items/);
  await expect(page.locator('#report-filter-reason')).toHaveText(/All reasons/);
  await entity.click();
  await page.getByRole('option', { name: 'Opportunity' }).click();
  await expect(entity).toHaveText(/Opportunity/);
  await entity.click();
  await page.getByRole('option', { name: 'All items' }).click();
  await expect(entity).toHaveText(/All items/);
  await expect.poll(() => requested.at(-1)).toBe('');
  expect(requested).toContain('job');
});
