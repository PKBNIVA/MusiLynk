import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API tests of the admin Funnel tab and the "Refunds to review" list inside Commerce. The
// real queries/authorization are covered by backend/test/integration/admin_funnel_and_legal_test.rb
// and backend/test/integration/booking_fee_and_refunds_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

const funnelSummary = {
  windowDays: 7,
  funnel: [
    { step: 'landing_view', count: 500 },
    { step: 'path_chosen', count: 300 },
    { step: 'signup_completed', count: 120 },
    { step: 'first_action', count: 60 },
    { step: 'booking_or_urgent_filled', count: 20 },
  ],
  weekly: [{ weekStart: '2026-09-21', bookings: 14, hires: 3 }],
  medianFirstResponseMinutes: 22.5,
  retentionWeek1: 41.2,
};

const pendingRefund = {
  id: 'r1',
  bookingRequestId: 'b1',
  bookingPaymentId: 'p1',
  amount: 24720,
  currency: 'INR',
  refundPercent: 100,
  reason: 'hirer_cancel',
  status: 'pending_manual',
  note: 'Cancelled more than 7 days before the event: full refund of the deposit.',
  policyVersion: 1,
  requestedBy: 'QA Buyer',
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-09-27T12:00:00Z',
  actName: 'The Night Owls',
  requesterName: 'QA Buyer',
};

// Every /api/admin/* the dashboard shell fetches on load, so a single tab can render alongside the rest.
const dashboardFixtures: Record<string, unknown> = {
  '/api/admin/stats': { stats: {} },
  '/api/admin/users': { users: [] },
  '/api/admin/jobs': { jobs: [] },
  '/api/admin/reviews': { reviews: [] },
  '/api/admin/verifications': { requests: [] },
  '/api/admin/reports': { reports: [] },
  '/api/admin/audit': { logs: [] },
  '/api/admin/subscriptions': { subscriptions: [] },
  '/api/admin/bookings': { bookings: [] },
  '/api/admin/billing-attempts': { attempts: [] },
  '/api/admin/billing-events': { events: [], nextBefore: null },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openAdmin(page: Page, extra: (route: Route, pathname: string) => boolean = () => false) {
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (extra(route, pathname)) return;
    const fixture = dashboardFixtures[pathname];
    return json(route, fixture ?? {});
  });
  await page.goto('/admin');
}

test('the Funnel tab shows the funnel, weekly bookings/hires, median response and retention', async ({ page }) => {
  await openAdmin(page, (route, pathname) => {
    if (pathname === '/api/admin/funnel') {
      json(route, funnelSummary);
      return true;
    }
    if (pathname === '/api/admin/emails') {
      json(route, {
        windowDays: 7,
        sentByKey: [{ key: 'musician_day1_first_link', count: 12 }],
        optOutRates: { masterOff: 4.5, categories: { digest: 10, lifecycle: 2, requests: 0, product: 1 } },
      });
      return true;
    }
    return false;
  });
  await page.getByRole('tab', { name: 'Funnel' }).click();
  await expect(page.getByRole('heading', { name: 'Funnel', level: 2 }).first()).toBeVisible();
  await expect(page.getByTestId('funnel-count-landing_view')).toHaveText('500');
  await expect(page.getByTestId('funnel-count-booking_or_urgent_filled')).toHaveText('20');
  await expect(page.getByText('14 bookings')).toBeVisible();
  await expect(page.getByTestId('median-first-response')).toHaveText('22.5 min');
  await expect(page.getByTestId('retention-week1')).toHaveText('41.2%');
  await expect(page.getByRole('heading', { name: 'Emails', level: 2 })).toBeVisible();
  await expect(page.getByTestId('emails-sent-musician_day1_first_link')).toHaveText('12');
  await expect(page.getByTestId('emails-opt-out-master')).toHaveText('4.5%');
  await expect(page.getByTestId('emails-opt-out-digest')).toHaveText('10%');

  await page.getByRole('button', { name: 'Last 30 days' }).click();
  await expect(page).toHaveURL(/\/admin/); // no navigation; just a re-fetch with days=30
});

test('Commerce shows a Refunds to review list and marking one done calls the API', async ({ page }) => {
  let markedDone = false;
  await openAdmin(page, (route, pathname) => {
    if (pathname === '/api/admin/refunds' && route.request().method() === 'GET') {
      json(route, { refunds: markedDone ? [] : [pendingRefund] });
      return true;
    }
    if (pathname === '/api/admin/refunds/r1' && route.request().method() === 'PATCH') {
      markedDone = true;
      json(route, { ...pendingRefund, status: 'done' });
      return true;
    }
    return false;
  });
  await page.getByRole('tab', { name: 'Commerce' }).click();
  await expect(page.getByRole('heading', { name: 'Refunds to review', level: 2 })).toBeVisible();
  await expect(page.getByText('The Night Owls')).toBeVisible();
  await expect(page.getByText('₹24,720')).toBeVisible();
  await expect(page.getByText('hirer cancel')).toBeVisible();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText('No refunds waiting on review.')).toBeVisible();
});
