import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API test of the admin Operations tab. The real endpoint and its aggregation are
// covered by backend/test/integration/admin_operations_view_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

const operations = {
  generatedAt: '2026-09-27T12:00:00Z',
  requests: {
    lastHour: { requests: 1240, serverErrors: 31, serverErrorRate: 0.025, p95Ms: 300, p95OverMs: null },
    last24Hours: { requests: 28000, serverErrors: 14, serverErrorRate: 0.0005, p95Ms: null, p95OverMs: 10000 },
    collectingSince: '2026-09-26T09:00:00Z',
  },
  jobs: {
    queued: 7,
    running: 1,
    scheduled: 3,
    oldestQueuedAt: '2026-09-27T11:40:00Z',
    oldestQueuedAgeSeconds: 1200,
    failed24h: 2,
    failedByClass24h: { EmailDeliveryJob: 2 },
    erroredRuns24h: 5,
  },
  payments: {
    bookingPayments: { failed24h: 1, pending24h: 4 },
    billingAttempts: { failed24h: 0, pending24h: 2 },
  },
  email: {
    deliveryFailures24h: 2,
    retriedSends24h: 6,
    addressesReported24h: { hard_bounce: 3, soft_bounce: 1 },
    suppressedAddresses: 9,
    webhookConfigured: false,
  },
};

async function openOperations(page: Page, respond: (route: Route) => Promise<void>) {
  const calls: string[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/me')) return json(200, { user: admin });
    if (pathname === '/api/admin/operations') {
      calls.push(pathname);
      return respond(route);
    }
    return json(200, {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Operations' }).click();
  const panel = page.getByTestId('operations-panel');
  await expect(panel).toBeVisible();
  return { panel, calls };
}

test('a red row lists the legal fields that are still placeholders, and disappears once they are filled', async ({
  page,
}) => {
  const { panel } = await openOperations(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...operations,
        legal: { unfilled: ['business.legal_name', 'grievance_officer.email'] },
      }),
    }),
  );
  const row = panel.getByTestId('legal-unfilled');
  await expect(row).toContainText('Legal details unfilled');
  await expect(row).toContainText('business.legal_name, grievance_officer.email');
});

test('no legal row is shown when every legal field is filled', async ({ page }) => {
  const { panel } = await openOperations(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...operations, legal: { unfilled: [] } }),
    }),
  );
  await expect(panel.getByRole('heading', { level: 2, name: 'API traffic' })).toBeVisible();
  await expect(panel.getByTestId('legal-unfilled')).toHaveCount(0);
});

test('admin sees traffic, jobs, payments and email health with problems highlighted', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { panel, calls } = await openOperations(page, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(operations) }),
  );

  await expect(panel.getByRole('heading', { level: 2, name: 'API traffic' })).toBeVisible();
  await expect(panel.getByTestId('hour-requests')).toContainText('1,240');
  await expect(panel.getByTestId('hour-p95')).toContainText('≤ 300 ms');
  await expect(panel.getByTestId('hour-errors')).toContainText('2.5%');
  await expect(panel.getByTestId('hour-errors')).toHaveAttribute('data-warn', 'true');
  await expect(panel.getByTestId('hour-p95')).not.toHaveAttribute('data-warn', 'true');
  await expect(panel.getByTestId('day-p95')).toContainText('> 10 s');
  await expect(panel.getByTestId('day-p95')).toHaveAttribute('data-warn', 'true');
  await expect(panel.getByTestId('day-errors')).toContainText('0.05%');

  await expect(panel.getByTestId('jobs-queued')).toContainText('7');
  await expect(panel.getByTestId('jobs-oldest')).toContainText('20 min');
  await expect(panel.getByTestId('jobs-oldest')).toHaveAttribute('data-warn', 'true');
  await expect(panel.getByTestId('jobs-failed')).toContainText('2');
  await expect(panel).toContainText('EmailDeliveryJob');

  await expect(panel.getByTestId('deposits-failed')).toContainText('1');
  await expect(panel.getByTestId('email-failures')).toContainText('2');
  await expect(panel).toContainText('hard bounce');
  await expect(panel).toContainText('The bounce webhook is not configured');
  await expect(panel).toContainText('Database backup');

  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('a failed load is reported and can be retried', async ({ page }) => {
  let fail = true;
  const { panel } = await openOperations(page, (route) =>
    fail
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'You do not have permission to perform this action' }),
        })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(operations) }),
  );
  await expect(panel.getByRole('alert')).toContainText('You do not have permission');
  fail = false;
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect(panel.getByRole('alert')).toBeHidden();
  await expect(panel.getByTestId('hour-requests')).toContainText('1,240');
});
