import { expect, test, type Page, type Route } from '@playwright/test';

// New report entry points (public profile, public act, review card) and the admin content
// moderation actions (unpublish job / hide review / hide act). Mocked-API only; the real
// endpoints are covered by backend/test/integration/{reports_test,report_moderation_test}.rb.
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

test.describe('admin content moderation actions', () => {
  test('unpublish job asks for confirmation, then closes the report', async ({ page }) => {
    const report = {
      id: 'rep-1',
      status: 'open',
      entity_type: 'job',
      entity_id: 'job-1',
      reason: 'Misleading listing',
      created_at: '2026-09-01T00:00:00Z',
      reporterName: 'Asha',
    };
    const context = {
      report: {
        id: 'rep-1',
        entityType: 'job',
        entityId: 'job-1',
        reason: 'Misleading listing',
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
});
