import { expect, test, type Page } from '@playwright/test';

// Mocked-API test of the admin Health tab (a read-only view of GET /api/admin/health). The
// endpoint itself is covered by backend/test/integration/admin_* and error_alerting_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

const health = {
  ok: true,
  service: 'musilynk-api',
  release: 'deadbeef0123',
  time: '2026-10-03T12:00:00Z',
  environment: 'production',
  coreReady: true,
  optionalIntegrationsReady: false,
  checks: {
    database: { ok: true, required: true, engine: 'postgresql' },
    frontendUrl: { ok: true, required: true },
    storage: { ok: true, required: false, uploadMethod: 'put' },
    razorpay: { ok: false, required: false, problems: ['missing_key'] },
  },
};

async function openHealth(page: Page, status = 200, body: unknown = health) {
  const calls: string[] = [];
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (code: number, payload: unknown) =>
      route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(payload) });
    if (pathname.endsWith('/me')) return json(200, { user: admin });
    if (pathname === '/api/admin/health') {
      calls.push(pathname);
      return json(status, body);
    }
    return json(200, {});
  });
  await page.goto('/admin');
  await page.getByRole('tab', { name: 'Health' }).click();
  const panel = page.getByTestId('health-panel');
  await expect(panel).toBeVisible();
  return { panel, calls };
}

test('the Health tab shows the release, readiness badges and each check with its details', async ({ page }) => {
  const { panel, calls } = await openHealth(page);
  await expect(panel.getByTestId('health-core')).toHaveText('Core ready');
  await expect(panel.getByTestId('health-optional')).toHaveText('Some integrations off');
  await expect(panel.getByTestId('health-release')).toContainText('deadbeef0123');
  await expect(panel.getByTestId('health-check-database')).toContainText('OK');
  const razorpay = panel.getByTestId('health-check-razorpay');
  await expect(razorpay).toContainText('Off');
  await expect(razorpay).toContainText('optional');
  await expect(razorpay).toContainText('problems: missing_key');
  // The URL remembers the tab, like every other admin tab.
  await expect(page).toHaveURL(/tab=health/);
  expect(calls).toEqual(['/api/admin/health']);

  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => calls.length).toBe(2);
});

test('a 503 from the health endpoint is explained rather than shown as a generic failure', async ({ page }) => {
  const { panel } = await openHealth(page, 503, { ...health, ok: false, coreReady: false });
  await expect(panel).toContainText('not ready (503)');
  await expect(panel.getByTestId('health-core')).toHaveCount(0);
});
