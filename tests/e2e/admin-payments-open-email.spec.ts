import { expect, test, type Page } from '@playwright/test';

// Mocked-API test of the admin "Email members waiting for payments" action. The counting,
// once-only sending and suppression rules are covered by
// backend/test/integration/admin_payments_open_emails_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

const window24 = { requests: 0, serverErrors: 0, serverErrorRate: null, p95Ms: null, p95OverMs: null };
const operations = {
  generatedAt: '2026-09-27T12:00:00Z',
  requests: { lastHour: window24, last24Hours: window24, collectingSince: null },
  jobs: {
    queued: 0,
    running: 0,
    scheduled: 0,
    oldestQueuedAt: null,
    oldestQueuedAgeSeconds: null,
    failed24h: 0,
    failedByClass24h: {},
    erroredRuns24h: 0,
  },
  payments: {
    bookingPayments: { failed24h: 0, pending24h: 0 },
    billingAttempts: { failed24h: 0, pending24h: 0 },
  },
  email: {
    deliveryFailures24h: 0,
    retriedSends24h: 0,
    addressesReported24h: {},
    suppressedAddresses: 0,
    webhookConfigured: true,
  },
};

async function openOperations(page: Page, summary: { usable: boolean; waiting: number; sendable: number }) {
  const posts: unknown[] = [];
  let current = summary;
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/me')) return json(200, { user: admin });
    if (pathname === '/api/admin/payments-open-email') {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        const queued = current;
        current = { ...current, waiting: 0, sendable: 0 };
        return json(202, queued);
      }
      return json(200, current);
    }
    if (pathname === '/api/admin/operations') return json(200, operations);
    return json(200, {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Operations' }).click();
  const card = page.getByTestId('payments-open-email');
  await expect(card).toBeVisible();
  return { card, posts };
}

test('the button is disabled, with a reason, while payments are not open', async ({ page }) => {
  const { card, posts } = await openOperations(page, { usable: false, waiting: 12, sendable: 12 });
  await expect(card.getByTestId('payments-open-waiting')).toContainText('12 members are waiting');
  await expect(card.getByRole('button', { name: 'Email members waiting for payments' })).toBeDisabled();
  await expect(card).toContainText('Payments are not open yet');
  expect(posts).toEqual([]);
});

test('shows how many are waiting, asks first, then queues the emails once', async ({ page }) => {
  const { card, posts } = await openOperations(page, { usable: true, waiting: 5, sendable: 4 });
  await expect(card.getByTestId('payments-open-waiting')).toContainText('5 members are waiting (4 can be emailed now)');
  const button = card.getByRole('button', { name: 'Email members waiting for payments' });
  await expect(button).toBeEnabled();

  await button.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Email 4 members?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(posts).toEqual([]);

  await button.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Send emails' }).click();
  await expect(page.getByText('Queued 4 emails.')).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(card.getByTestId('payments-open-waiting')).toContainText('0 members are waiting');
  await expect(button).toBeDisabled();
});
