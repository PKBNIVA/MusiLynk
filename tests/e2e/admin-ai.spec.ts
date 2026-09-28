import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Mocked-API test of the admin AI tab: this month's spend, budget guardrails and the
// grant-credits form. The real endpoints (Admin::AiController) are covered by
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
  totalSpendInr: 4200,
  freeTierSpendInr: 1800,
  freeTierBudgetInr: 5000,
  hardBudgetInr: 20000,
  byTask: { job_description: 2200, profile_bio: 900, candidate_summary: 1100 },
  byTier: { free: 1800, pro: 1900, studio: 500 },
  topAccounts: [
    { accountType: 'user', accountId: 'user-1', spendInr: 900 },
    { accountType: 'organization', accountId: 'org-1', spendInr: 700 },
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
  await page.getByRole('tab', { name: 'AI' }).click();
  return calls;
}

test('the AI tab shows spend by task and tier, budget bars and top accounts', async ({ page }) => {
  await openAdminAiTab(page);
  await expect(page.getByRole('heading', { name: 'Spend this month', level: 2 })).toBeVisible();
  await expect(page.getByText('₹4,200', { exact: true })).toBeVisible();
  await expect(page.getByText('₹1,800', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('job_description')).toBeVisible();
  await expect(page.getByText('candidate_summary')).toBeVisible();
  await expect(page.getByText('free', { exact: true })).toBeVisible();
  await expect(page.getByText('user:user-1')).toBeVisible();
  await expect(page.getByText('organization:org-1')).toBeVisible();
  // Budget bars: free-tier 1800/5000 = 36%, hard 4200/20000 = 21%.
  await expect(page.getByText('36%')).toBeVisible();
  await expect(page.getByText('21%')).toBeVisible();
});

test('granting credits asks for confirmation, then posts the grant and refreshes spend', async ({ page }) => {
  let granted: Record<string, unknown> | null = null;
  const calls = await openAdminAiTab(page, (route, pathname) => {
    if (pathname === '/api/admin/ai/grants' && route.request().method() === 'POST') {
      granted = route.request().postDataJSON();
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, balance: 150 }),
      });
      return true;
    }
    return false;
  });

  await page.getByRole('button', { name: 'Grant credits' }).click();
  await chooseOption(page.getByLabel('Account type'), 'Organization');
  await page.getByLabel('Credits', { exact: true }).fill('150');
  await page.getByLabel('Account id').fill('org-42');
  await page.getByLabel('Reason').fill('Goodwill credit for a support case.');
  await page.getByRole('button', { name: 'Grant' }).click();

  const confirm = page.getByRole('dialog', { name: 'Confirm grant' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('150 AI credits to organization:org-42');
  // Not sent yet — the confirmation step must be explicitly accepted.
  expect(calls.some((c) => c.path === '/admin/ai/grants')).toBe(false);

  const axeResult = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axeResult.violations, axeResult.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual(
    [],
  );

  await confirm.getByRole('button', { name: 'Confirm grant' }).click();
  await expect(confirm).toBeHidden();
  expect(granted).toEqual({
    accountType: 'organization',
    accountId: 'org-42',
    credits: 150,
    note: 'Goodwill credit for a support case.',
  });
  // The costs endpoint is refetched after a successful grant.
  expect(calls.filter((c) => c.path === '/admin/ai/costs').length).toBeGreaterThanOrEqual(2);
});
