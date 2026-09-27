import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API tests of report review and moderation, the scam safety notice and the conduct rules.
// The real endpoints are covered by backend/test/integration/report_moderation_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString();
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const report = {
  id: 'rep-1',
  status: 'open',
  entity_type: 'user',
  entity_id: 'user-scam',
  reason: 'Asked me to pay a registration fee',
  details: 'They wanted money first.\n\nReported from conversation conv-1.',
  created_at: at(20),
  reporterName: 'Asha Singer',
};
const context = {
  report: {
    id: 'rep-1',
    entityType: 'user',
    entityId: 'user-scam',
    reason: report.reason,
    details: report.details,
    status: 'open',
    createdAt: at(20),
    reporterId: 'user-asha',
    reporterName: 'Asha Singer',
  },
  reportedUser: {
    id: 'user-scam',
    name: 'Shady Casting',
    email: 'shady@example.invalid',
    role: 'employer',
    status: 'active',
  },
  history: {
    reportsTotal: 3,
    reportsLast90Days: 2,
    openReports: 1,
    warnings: 1,
    suspensions: 0,
    flaggedMessagesLast90Days: 4,
  },
  conversation: {
    id: 'conv-1',
    jobTitle: 'Playback singer',
    earlierMessages: 5,
    laterMessages: 1,
    messages: [
      {
        id: 'm1',
        senderId: 'user-asha',
        senderName: 'Asha Singer',
        body: 'Hi, I am interested in the role',
        createdAt: at(10),
      },
      {
        id: 'm2',
        senderId: 'user-scam',
        senderName: 'Shady Casting',
        body: 'Selected! Registration fee 1500 dena hoga',
        createdAt: at(11),
        safetyFlags: ['upfront_fee'],
      },
    ],
  },
  guidelinesUrl: '/community-guidelines',
};

async function openAdmin(page: Page, contextStatus = 200) {
  const state = { reports: [report] as (typeof report)[], moderated: [] as unknown[], contextReads: 0 };
  const dashboard: Record<string, unknown> = {
    '/api/admin/stats': { stats: { openReports: 1, flaggedMessages: 7 } },
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
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (pathname === '/api/admin/reports') return json(route, { reports: state.reports });
    if (pathname === '/api/admin/reports/rep-1/context') {
      state.contextReads += 1;
      return contextStatus === 200
        ? json(route, context)
        : json(route, { error: 'Report store offline' }, contextStatus);
    }
    if (pathname === '/api/admin/reports/rep-1/moderate' && request.method() === 'POST') {
      state.moderated.push(request.postDataJSON());
      state.reports = [];
      return json(route, { ok: true, report: { ...context.report, status: 'resolved' } });
    }
    return json(route, dashboard[pathname] ?? {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: /Reports/ }).click();
  return state;
}

test('admin reviews a conversation report with context and warns the user', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => {
    errors.push(`native dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  const state = await openAdmin(page);

  await expect(page.getByTestId('flagged-messages')).toContainText('7 messages flagged for scam patterns');
  await page.getByRole('button', { name: `Review report: ${report.reason}` }).click();

  const review = page.getByTestId('report-review');
  await expect(review.getByRole('heading', { name: 'Shady Casting' })).toBeVisible();
  const history = review.getByTestId('report-history');
  await expect(history).toContainText('Reports (all time)3');
  await expect(history).toContainText('Flagged messages (90 days)4');
  const excerpt = review.getByTestId('report-excerpt');
  await expect(excerpt.getByRole('listitem')).toHaveCount(2);
  await expect(excerpt).toContainText('Asha Singer (reporter)');
  await expect(excerpt.getByRole('listitem').nth(1)).toContainText('Asks for an upfront fee');
  await expect(review).toContainText('5 earlier not shown');
  await expect(review.getByRole('link', { name: 'community guidelines' })).toHaveAttribute(
    'href',
    '/community-guidelines',
  );
  expect(state.contextReads).toBe(1);

  await review.getByRole('button', { name: 'Warn' }).click();
  await review.getByLabel(/Note to the user/).fill('Do not ask artists for fees.');
  await review.getByTestId('confirm-decision').click();

  await expect(page.getByText('Warning sent and report resolved')).toBeVisible();
  await expect(review).toBeHidden();
  expect(state.moderated).toEqual([{ decision: 'warn', note: 'Do not ask artists for fees.' }]);
  await expect(page.getByText('No open safety reports.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('admin suspends from a report and can back out of a decision', async ({ page }) => {
  const state = await openAdmin(page);
  await page.getByRole('button', { name: `Review report: ${report.reason}` }).click();
  const review = page.getByTestId('report-review');
  await expect(review.getByTestId('report-excerpt')).toBeVisible();

  await review.getByRole('button', { name: 'Dismiss' }).click();
  await review.getByRole('button', { name: 'Back' }).click();
  await review.getByRole('button', { name: 'Suspend' }).click();
  await expect(review.getByText(/signs it out everywhere/)).toBeVisible();
  await review.getByTestId('confirm-decision').click();
  await expect(page.getByText('User suspended and report resolved')).toBeVisible();
  expect(state.moderated).toEqual([{ decision: 'suspend' }]);
});

test('a failed context load is shown and nothing can be decided', async ({ page }) => {
  await openAdmin(page, 500);
  await page.getByRole('button', { name: `Review report: ${report.reason}` }).click();
  const review = page.getByTestId('report-review');
  await expect(review.getByRole('alert')).toContainText('Report store offline');
  for (const name of ['Dismiss', 'Warn', 'Suspend']) await expect(review.getByRole('button', { name })).toBeDisabled();
});

test('the recipient sees a safety notice on a flagged message, the sender never does', async ({ page }) => {
  const conversation = {
    id: 'conv-1',
    counterpartId: 'user-scam',
    counterpartName: 'Shady Casting',
    viewerSide: 'candidate',
    counterpartActive: true,
    lastMessage: 'Selected!',
    lastMessageAt: at(12),
    unreadCount: 0,
  };
  const messages = [
    { id: 'm1', senderId: 'me-1', body: 'Hi, I am interested', createdAt: at(10), readAt: at(11) },
    {
      id: 'm2',
      senderId: 'user-scam',
      body: 'Selected! Registration fee 1500. WhatsApp 9876543210',
      createdAt: at(11),
      readAt: null,
      safetyFlags: ['upfront_fee', 'off_platform'],
    },
    { id: 'm3', senderId: 'user-scam', body: 'Rehearsal is at 5pm', createdAt: at(12), readAt: null },
  ];
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me')
      return json(route, {
        user: {
          id: 'me-1',
          name: 'Asha Singer',
          email: 'asha@example.invalid',
          role: 'jobseeker',
          status: 'active',
          profileComplete: true,
        },
      });
    if (path === '/conversations') return json(route, { conversations: [conversation] });
    if (path === '/conversations/conv-1/messages') return json(route, { messages, truncated: false, limit: 200 });
    if (path === '/notifications/unread') return json(route, { unread: 0, unreadMessages: 0 });
    return json(route, {});
  });
  await page.goto('/jobseeker/messages?c=conv-1');

  const bubbles = page.getByTestId('message');
  await expect(bubbles).toHaveCount(3);
  await expect(page.getByTestId('safety-notice')).toHaveCount(1);
  const notice = bubbles.nth(1).getByTestId('safety-notice');
  await expect(notice).toContainText('never ask you to pay a registration, audition or joining fee');
  await expect(notice).toContainText('moving to WhatsApp or Telegram');
  await expect(notice).not.toContainText('UPI');
  await expect(notice.getByRole('link', { name: 'community guidelines' })).toHaveAttribute(
    'href',
    '/community-guidelines',
  );
});

test('a moderation warning notification opens the community guidelines, which cover scams and harassment', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me')
      return json(route, {
        user: {
          id: 'emp-1',
          name: 'Casting Co',
          email: 'c@example.invalid',
          role: 'employer',
          status: 'active',
          profileComplete: true,
        },
      });
    if (path === '/notifications')
      return json(route, {
        notifications: [
          {
            id: 'n1',
            type: 'moderation_warning',
            title: 'A warning from Verse moderation',
            body: 'Do not ask artists for fees.',
            link: '/community-guidelines',
            readAt: null,
            createdAt: at(1),
          },
        ],
        unread: 1,
      });
    if (path === '/notifications/unread') return json(route, { unread: 1, unreadMessages: 0 });
    if (path === '/notifications/preferences') return json(route, { emailNotifications: true });
    return json(route, { ok: true });
  });
  await page.goto('/employer/notifications');
  const open = page.getByTestId('notification').getByRole('link', { name: 'Open' });
  await expect(open).toHaveAttribute('href', '/community-guidelines');

  await page.goto('/community-guidelines');
  await expect(page.getByRole('heading', { name: 'No scams or fee requests' })).toBeVisible();
  await expect(page.getByText(/no “registration”, audition, portfolio, joining or security fees/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No harassment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reporting and enforcement' })).toBeVisible();
});
