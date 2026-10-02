import { expect, test, type Route } from '@playwright/test';

// Mocked-API tests of the scam safety notice and the conduct rules (admin report review is in
// admin-report-review.spec.ts). The real endpoints are covered by backend/test/integration/report_moderation_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString();
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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
            title: 'A warning from MusiLynk moderation',
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
  const open = page.getByTestId('notification').getByRole('link', { name: 'See details' });
  await expect(open).toHaveAttribute('href', '/community-guidelines');

  await page.goto('/community-guidelines');
  await expect(page.getByRole('heading', { name: 'No scams or fee requests' })).toBeVisible();
  await expect(page.getByText(/no “registration”, audition, portfolio, joining or security fees/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No harassment' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reporting and enforcement' })).toBeVisible();
});
