import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API test of the admin "AI spend" tab: this month's spend by task and tier, and the
// budget guardrails. The grant-credits form is gone at launch (AI billing stays off, so there is
// nothing to grant against). The real endpoints (Admin::AiController) are covered by
// backend/test/integration/admin_ai_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

const costs = {
  totalSpendInr: 420,
  freeTierSpendInr: 420,
  freeTierBudgetInr: 1500,
  hardBudgetInr: 1500,
  byTask: { job_description: 220, profile_bio: 100, profile_headline: 100 },
  byTier: { free: 420 },
  topAccounts: [
    { accountType: 'user', accountId: 'user-1', spendInr: 90 },
    { accountType: 'user', accountId: 'user-2', spendInr: 70 },
  ],
};

// Every /api/admin/* the dashboard shell fetches on load, so the AI tab can render alongside the rest.
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
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openAdminAiTab(page: Page, extra: (route: Route, pathname: string) => boolean = () => false) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url());
    let body: unknown = null;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = route.request().postData();
    }
    calls.push({ method: route.request().method(), path: pathname.replace(/^\/api/, ''), body });
    if (pathname.endsWith('/me')) return json(route, { user: admin });
    if (pathname === '/api/admin/ai/costs') return json(route, costs);
    if (extra(route, pathname)) return;
    const fixture = dashboardFixtures[pathname];
    return json(route, fixture ?? {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'AI spend' }).click();
  return calls;
}

test('the AI spend tab shows spend by task and tier, budget bars and top accounts, with no grant form', async ({
  page,
}) => {
  await openAdminAiTab(page);
  await expect(page.getByRole('heading', { name: 'Spend this month', level: 2 })).toBeVisible();
  await expect(page.getByText('₹420', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('job_description')).toBeVisible();
  await expect(page.getByText('profile_bio')).toBeVisible();
  await expect(page.getByText('free', { exact: true })).toBeVisible();
  await expect(page.getByText('user:user-1')).toBeVisible();
  await expect(page.getByText('user:user-2')).toBeVisible();
  // Budget bars: free-tier and hard are both 420/1500 = 28%.
  await expect(page.getByText('28%').first()).toBeVisible();

  await expect(page.getByRole('button', { name: 'Grant credits' })).toHaveCount(0);
  await expect(page.getByText('Grant AI credits')).toHaveCount(0);

  const axeResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axeResult.violations, axeResult.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual(
    [],
  );
});

test('the AI spend tab never posts a grant, even on reload', async ({ page }) => {
  const calls = await openAdminAiTab(page);
  expect(calls.some((c) => c.path === '/admin/ai/grants')).toBe(false);
});
