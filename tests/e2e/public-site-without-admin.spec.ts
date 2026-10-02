import { expect, test, type Page, type Route } from '@playwright/test';

// The public build has no admin pages (they live on the separate admin site, admin-*.spec.ts), and
// an admin who tries to sign in here is told where to go without the admin address being shown.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};

async function mockApi(page: Page, opts: { signedIn?: boolean; loginReply?: { status: number; body: unknown } } = {}) {
  const calls = { logins: 0, completions: 0, logouts: 0, adminCalls: [] as string[] };
  if (opts.signedIn) await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.startsWith('/api/admin')) calls.adminCalls.push(pathname);
    if (pathname.endsWith('/auth/methods'))
      return json(200, { signInCodes: true, password: true, emailDelivery: true });
    if (pathname.endsWith('/auth/login')) {
      calls.logins += 1;
      return opts.loginReply
        ? json(opts.loginReply.status, opts.loginReply.body)
        : json(202, {
            secondFactorRequired: true,
            method: 'email_code',
            challengeToken: 'challenge-1',
            message: 'Admin sign-in needs one more step.',
            expiresIn: 600,
          });
    }
    if (pathname.endsWith('/auth/second-factor')) {
      calls.completions += 1;
      return json(200, { user: admin, accessToken: 'qa-admin-token' });
    }
    if (pathname.endsWith('/auth/logout')) {
      calls.logouts += 1;
      return json(200, { ok: true });
    }
    if (pathname.endsWith('/me'))
      return request.headers().authorization
        ? json(200, { user: admin })
        : json(401, { error: 'Authentication required' });
    return json(200, {});
  });
  return calls;
}

async function passwordSignIn(page: Page) {
  await page.goto('/auth/jobseeker');
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill('StrongPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

const token = (page: Page) => page.evaluate(() => localStorage.getItem('musilynk_access_token'));

test('admin pages and the admin sign-in page are 404s, even for a signed-in admin', async ({ page }) => {
  const calls = await mockApi(page, { signedIn: true });
  for (const path of ['/admin', '/admin/tester', '/auth/admin', '/account']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('Marketplace health')).toHaveCount(0);
  }
  expect(calls.adminCalls).toEqual([]);
});

test('the public navigation no longer links to admin sign-in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('a[href^="/auth/admin"], a[href^="/admin"]')).toHaveCount(0);
});

test('when the API sends admins to the admin site, the message shows inline with no redirect', async ({ page }) => {
  await mockApi(page, {
    loginReply: { status: 403, body: { error: 'Admins sign in at the admin site.', code: 'ADMIN_USE_ADMIN_SITE' } },
  });
  await passwordSignIn(page);
  await expect(page.getByRole('alert')).toHaveText('Admins sign in at the admin site.');
  await expect(page).toHaveURL(/\/auth\/jobseeker$/);
  expect(await token(page)).toBeNull();
});

test('an admin session started here anyway is ended at once with the same message', async ({ page }) => {
  const calls = await mockApi(page);
  await passwordSignIn(page);
  await page.getByLabel('Sign-in code').fill('482913');
  await expect(page.getByRole('alert')).toHaveText('Admins sign in at the admin site.');
  await expect(page).toHaveURL(/\/auth\/jobseeker$/);
  expect(calls.completions).toBe(1);
  await expect.poll(() => calls.logouts).toBe(1);
  expect(await token(page)).toBeNull();
});
