import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for signing in on the admin site (admin build, admin-desktop project): the
// password step answers with a challenge, and the code emailed to the admin completes it.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const jobseeker = { ...admin, id: 'qa-jobseeker', email: 'artist@example.invalid', role: 'jobseeker' };
const PASSWORD = 'StrongPass123!';
const VALID_CODE = '482913';

interface Calls {
  logins: Record<string, unknown>[];
  completions: Record<string, unknown>[];
  logouts: number;
}

async function mockApi(
  page: Page,
  opts: {
    expireChallenge?: boolean;
    loginReply?: { status: number; body: unknown };
    signedIn?: typeof admin;
  } = {},
) {
  const calls: Calls = { logins: [], completions: [], logouts: 0 };
  if (opts.signedIn) await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/auth/login')) {
      calls.logins.push(request.postDataJSON());
      if (opts.loginReply) return json(opts.loginReply.status, opts.loginReply.body);
      return json(202, {
        secondFactorRequired: true,
        method: 'email_code',
        challengeToken: `challenge-${calls.logins.length}`,
        message: 'Admin sign-in needs one more step.',
        expiresIn: 600,
      });
    }
    if (pathname.endsWith('/auth/second-factor')) {
      const body = request.postDataJSON();
      calls.completions.push(body);
      if (opts.expireChallenge)
        return json(401, {
          error: 'This sign-in step has expired. Sign in with your password again.',
          code: 'SECOND_FACTOR_EXPIRED',
        });
      return body.code === VALID_CODE
        ? json(200, { user: admin, accessToken: 'qa-admin-token' })
        : json(401, { error: 'Invalid or expired code.', code: 'OTP_INVALID' });
    }
    if (pathname.endsWith('/auth/logout')) {
      calls.logouts += 1;
      return json(200, { ok: true });
    }
    if (pathname.endsWith('/me'))
      return request.headers().authorization
        ? json(200, { user: opts.signedIn ?? admin })
        : json(401, { error: 'Authentication required' });
    if (pathname === '/api/admin/account')
      return json(200, { email: admin.email, emailDeliverable: true, secondFactor: 'enforced', adminOrigin: true });
    return json(200, {});
  });
  return calls;
}

async function fillPassword(page: Page) {
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function submitPassword(page: Page) {
  await page.goto('/');
  await fillPassword(page);
}

const token = (page: Page) => page.evaluate(() => localStorage.getItem('verse_access_token'));

test('the admin site is titled, kept out of search engines and offers only password sign-in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Verse Admin/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByRole('button', { name: /code instead|create .* account/i })).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
});

test('an admin password asks for the emailed code, which completes sign-in', async ({ page }) => {
  const calls = await mockApi(page);
  await submitPassword(page);

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('Admin sign-in needs one more step.')).toBeVisible();
  const code = page.getByLabel('Sign-in code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();
  expect(await token(page)).toBeNull();

  await code.fill('111111');
  await expect(page.getByRole('alert')).toHaveText('Invalid or expired code.');
  await expect(code).toHaveValue('');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('aria-invalid', 'true');

  await code.fill(VALID_CODE);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
  expect(calls.logins).toEqual([{ email: admin.email, password: PASSWORD }]);
  expect(calls.completions).toEqual([
    { challengeToken: 'challenge-1', code: '111111' },
    { challengeToken: 'challenge-1', code: VALID_CODE },
  ]);
  expect(await token(page)).toBe('qa-admin-token');
});

test('resend waits for the cooldown and then asks for a fresh challenge', async ({ page }) => {
  await page.clock.install();
  const calls = await mockApi(page);
  await submitPassword(page);
  const resend = page.getByRole('button', { name: /Resend code/ });
  await expect(resend).toBeDisabled();
  await page.clock.runFor(61_000);
  await expect(resend).toHaveText('Resend code');
  await resend.click();
  await expect.poll(() => calls.logins.length).toBe(2);
  await page.getByLabel('Sign-in code').fill(VALID_CODE);
  await expect(page).toHaveURL(/\/admin$/);
  expect(calls.completions).toEqual([{ challengeToken: 'challenge-2', code: VALID_CODE }]);
});

test('an expired challenge returns to the password form with the reason', async ({ page }) => {
  const calls = await mockApi(page, { expireChallenge: true });
  await submitPassword(page);
  await page.getByLabel('Sign-in code').fill(VALID_CODE);

  await expect(page.getByRole('alert')).toHaveText('This sign-in step has expired. Sign in with your password again.');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Sign-in code')).toHaveCount(0);
  expect(calls.completions).toHaveLength(1);
  expect(await token(page)).toBeNull();
});

test('back to sign in leaves the challenge without a session', async ({ page }) => {
  await mockApi(page);
  await submitPassword(page);
  await expect(page.getByLabel('Sign-in code')).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await token(page)).toBeNull();
});

test('an unavailable second step is explained inline and no session starts', async ({ page }) => {
  const message =
    'Admin sign-in needs an emailed code, but email delivery is not configured on the server. Configure an email provider to sign in.';
  await mockApi(page, { loginReply: { status: 503, body: { error: message, code: 'SECOND_FACTOR_UNAVAILABLE' } } });
  await submitPassword(page);
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await expect(page).toHaveURL(/127\.0\.0\.1:4176\/$/);
  expect(await token(page)).toBeNull();
});

test('a non-admin account is signed out again and told this site is for admins', async ({ page }) => {
  const calls = await mockApi(page, { loginReply: { status: 200, body: { user: jobseeker, accessToken: 'qa-js' } } });
  await submitPassword(page);
  await expect(page.getByRole('alert')).toContainText('This site is only for Verse admins.');
  await expect.poll(() => calls.logouts).toBe(1);
  expect(await token(page)).toBeNull();
});

test('a signed-out visit to a console page signs in first and then returns there', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/tester');
  await expect(page).toHaveURL(/127\.0\.0\.1:4176\/$/);
  await fillPassword(page);
  await page.getByLabel('Sign-in code').fill(VALID_CODE);
  await expect(page).toHaveURL(/\/admin\/tester$/);
});

test('a signed-in admin opening the site goes straight to the console', async ({ page }) => {
  await mockApi(page, { signedIn: admin });
  await page.goto('/');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
});

test('public pages do not exist on the admin site', async ({ page }) => {
  await mockApi(page, { signedIn: admin });
  for (const path of ['/auth/jobseeker', '/auth/admin', '/music-jobs', '/jobseeker']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});
