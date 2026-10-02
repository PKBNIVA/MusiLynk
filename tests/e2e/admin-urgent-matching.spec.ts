import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage of the admin "Urgent matching" tab (Admin::UrgentRequestsController).
// The real endpoints are covered by backend/test/integration/admin_urgent_requests_test.rb.
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

const request = {
  id: 'urg_1',
  title: 'Drummer needed tonight',
  role_name: 'Drummer',
  city: 'Mumbai',
  status: 'open',
  requesterName: 'Blue Note Studio',
  ageMinutes: 75,
  noResponseAfterWindow: true,
  responseCount: 0,
  notified_count: 3,
  founder_notes: '',
};
const funnel = { requestsToday: 4, notifiedToday: 3, respondedToday: 1, filledWithin24hToday: 1 };
const candidate = {
  userId: 'user-musician-1',
  name: 'Ready Musician',
  score: 85,
  reasons: ['Role match', 'Same city', 'Verified'],
  city: 'Mumbai',
  verified: true,
  lastActiveAt: null,
  alreadyNotified: false,
  alreadyResponded: false,
};

async function openAdmin(page: Page) {
  const state = { notified: [] as unknown[], updated: [] as unknown[] };
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-admin-token'));
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (pathname === '/api/admin/stats') return json(route, { stats: { openReports: 0 } });
    if (pathname === '/api/admin/urgent-requests') return json(route, { requests: [request], funnel });
    if (pathname === '/api/admin/urgent-requests/urg_1/candidates') return json(route, { candidates: [candidate] });
    if (pathname === '/api/admin/urgent-requests/urg_1/notify' && req.method() === 'POST') {
      state.notified.push(req.postDataJSON());
      return json(route, { ok: true, sent: true });
    }
    if (pathname === '/api/admin/urgent-requests/urg_1' && req.method() === 'PATCH') {
      state.updated.push(req.postDataJSON());
      return json(route, { ok: true, request: { ...request, status: 'filled' } });
    }
    return json(route, {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Urgent matching' }).click();
  return state;
}

test('admin sees the funnel and the flagged request, then notifies a candidate', async ({ page }) => {
  const state = await openAdmin(page);

  await expect(page.getByText('Requests today')).toBeVisible();
  await expect(page.getByText('4', { exact: true })).toBeVisible();
  await expect(page.getByText('No response after 60m')).toBeVisible();
  await expect(page.getByText('Drummer needed tonight')).toBeVisible();

  await page.getByRole('button', { name: 'Candidates' }).click();
  await expect(page.getByText('Ready Musician')).toBeVisible();
  await page.getByRole('button', { name: 'Notify' }).click();

  await expect(page.getByText('Alert sent')).toBeVisible();
  expect(state.notified).toEqual([{ candidateUserId: 'user-musician-1' }]);
});

test('admin marks a request filled', async ({ page }) => {
  const state = await openAdmin(page);
  await page.getByRole('button', { name: 'Mark filled' }).click();

  await expect(page.getByText('Marked filled')).toBeVisible();
  expect(state.updated).toEqual([{ status: 'filled', filledByUserId: undefined }]);
});

test('a saved founder note is still there after the row is collapsed and opened again', async ({ page }) => {
  const state = await openAdmin(page);
  await page.getByRole('button', { name: 'Candidates' }).click();
  await page.getByLabel('Founder notes').fill('Called the studio; they want a Friday drummer.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Note saved')).toBeVisible();
  expect(state.updated).toEqual([{ founderNotes: 'Called the studio; they want a Friday drummer.' }]);

  await page.getByRole('button', { name: 'Hide candidates' }).click();
  await page.getByRole('button', { name: 'Candidates' }).click();
  await expect(page.getByLabel('Founder notes')).toHaveValue('Called the studio; they want a Friday drummer.');
});
