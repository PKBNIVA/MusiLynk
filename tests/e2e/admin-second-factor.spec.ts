import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for the admin two-step sign-in: the password step answers with a
// challenge, and the code emailed to the admin completes it.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const PASSWORD = 'StrongPass123!';
const VALID_CODE = '482913';

interface Calls {
  logins: Record<string, unknown>[];
  completions: Record<string, unknown>[];
}

async function mockApi(
  page: Page,
  opts: { expireChallenge?: boolean; loginReply?: { status: number; body: unknown } } = {},
) {
  const calls: Calls = { logins: [], completions: [] };
  await page.addInitScript(() => localStorage.setItem('verse-tour-v2-admin', 'done'));
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/auth/methods'))
      return json(200, { signInCodes: true, password: true, emailDelivery: true });
    if (pathname.endsWith('/auth/login')) {
      calls.logins.push(request.postDataJSON());
      if (opts.loginReply) return json(opts.loginReply.status, opts.loginReply.body);
      const challengeToken = `challenge-${calls.logins.length}`;
      return json(202, {
        secondFactorRequired: true,
        method: 'email_code',
        challengeToken,
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
    if (pathname.endsWith('/me'))
      return request.headers().authorization
        ? json(200, { user: admin })
        : json(401, { error: 'Authentication required' });
    if (pathname.endsWith('/notifications/unread')) return json(200, { unread: 0 });
    if (pathname.endsWith('/notifications')) return json(200, { notifications: [], unread: 0 });
    return json(200, {});
  });
  return calls;
}

async function submitPassword(page: Page) {
  await page.goto('/auth/admin');
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('an admin password asks for the emailed code, which completes sign-in', async ({ page }) => {
  const calls = await mockApi(page);
  await submitPassword(page);

  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByText('Admin sign-in needs one more step.')).toBeVisible();
  await expect(page.getByLabel('Sign-in code')).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();

  await page.getByLabel('Sign-in code').fill('111111');
  await expect(page.getByRole('alert')).toHaveText('Invalid or expired code.');
  await expect(page.getByLabel('Sign-in code')).toHaveValue('');

  await page.getByLabel('Sign-in code').fill(VALID_CODE);
  await expect(page).toHaveURL(/\/admin$/);
  expect(calls.logins).toEqual([{ email: admin.email, password: PASSWORD }]);
  expect(calls.completions).toEqual([
    { challengeToken: 'challenge-1', code: '111111' },
    { challengeToken: 'challenge-1', code: VALID_CODE },
  ]);
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBe('qa-admin-token');
});

test('an expired challenge returns to the password form', async ({ page }) => {
  const calls = await mockApi(page, { expireChallenge: true });
  await submitPassword(page);
  await page.getByLabel('Sign-in code').fill(VALID_CODE);

  await expect(
    page.getByText('This sign-in step has expired. Sign in with your password again.').first(),
  ).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sign-in code')).toHaveCount(0);
  expect(calls.completions).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();
});

test('back to sign in leaves the challenge without a session', async ({ page }) => {
  await mockApi(page);
  await submitPassword(page);
  await expect(page.getByLabel('Sign-in code')).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('when the server cannot email the second step, the admin sees why and no session starts', async ({ page }) => {
  const message =
    'Admin sign-in needs an emailed code, but email delivery is not configured on the server. Configure an email provider to sign in.';
  await mockApi(page, { loginReply: { status: 503, body: { error: message, code: 'SECOND_FACTOR_UNAVAILABLE' } } });
  await submitPassword(page);
  await expect(page.getByText(message).first()).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/admin$/);
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();
});
