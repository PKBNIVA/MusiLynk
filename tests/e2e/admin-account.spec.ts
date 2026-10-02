import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for the admin's own account on the admin site: the warning banner while
// two-step sign-in is not protecting the admin, changing the admin email (request → code →
// confirm) and changing the password. The API contract is Admin::AccountController.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@musilynk.local',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const VALID_CODE = '482913';
const EXPIRED_CODE = '999999';
const EXPIRED_MESSAGE = 'This email change has expired or was started by someone else. Start again.';
type Health = { email: string; emailDeliverable: boolean; secondFactor: string; adminOrigin: boolean };
const undeliverable: Health = {
  email: admin.email,
  emailDeliverable: false,
  secondFactor: 'skipped',
  adminOrigin: true,
};

interface Calls {
  requests: Record<string, unknown>[];
  confirms: Record<string, unknown>[];
  passwords: Record<string, unknown>[];
  accountReads: number;
}

async function openAccount(page: Page, opts: { health?: Health; path?: string } = {}) {
  const calls: Calls = { requests: [], confirms: [], passwords: [], accountReads: 0 };
  let health = opts.health ?? undeliverable;
  let user = admin;
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/me')) return json(200, { user });
    if (pathname === '/api/admin/account') {
      calls.accountReads += 1;
      return json(200, health);
    }
    if (pathname === '/api/admin/account/email/request') {
      const body = request.postDataJSON();
      calls.requests.push(body);
      if (String(body.email).endsWith('.local'))
        return json(422, {
          error: 'That address can never receive email. Use a real mailbox.',
          code: 'EMAIL_UNDELIVERABLE',
        });
      if (body.email === 'taken@example.com')
        return json(409, { error: 'Another account already uses that email.', code: 'EMAIL_TAKEN' });
      return json(202, { changeToken: `change-${calls.requests.length}`, expiresIn: 600 });
    }
    if (pathname === '/api/admin/account/email/confirm') {
      const body = request.postDataJSON();
      calls.confirms.push(body);
      if (body.code === EXPIRED_CODE) return json(422, { error: EXPIRED_MESSAGE, code: 'EMAIL_CHANGE_EXPIRED' });
      if (body.code !== VALID_CODE)
        return json(422, { error: 'That code is not right. Check the email and try again.', code: 'OTP_INVALID' });
      user = { ...admin, email: 'ops@example.com' };
      health = { email: 'ops@example.com', emailDeliverable: true, secondFactor: 'enforced', adminOrigin: true };
      return json(200, { user });
    }
    if (pathname === '/api/admin/account/password') {
      const body = request.postDataJSON();
      calls.passwords.push(body);
      return body.currentPassword === 'CurrentPass123!'
        ? json(200, { ok: true })
        : json(403, { error: 'Your current password is incorrect.', code: 'PASSWORD_INCORRECT' });
    }
    return json(200, {});
  });
  await page.goto(opts.path ?? '/account');
  return calls;
}

const banner = (page: Page) => page.getByRole('complementary', { name: 'Sign-in security warning' });

test('the warning banner shows on every admin page until the admin email can receive codes', async ({ page }) => {
  await openAccount(page, { path: '/admin' });
  await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
  await expect(banner(page)).toContainText(
    'Two-step sign-in is off for your account because your admin email address cannot receive email.',
  );
  await page.goto('/admin/tester');
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole('link', { name: 'Set a real email address' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Your admin account' })).toBeVisible();
  await expect(banner(page)).toContainText('Set a real email address below.');
});

test('the banner explains a second step turned off on the server', async ({ page }) => {
  await openAccount(page, {
    path: '/admin',
    health: { email: 'ops@example.com', emailDeliverable: true, secondFactor: 'off', adminOrigin: true },
  });
  await expect(banner(page)).toContainText('because it is turned off on the server.');
});

test('no banner once two-step sign-in is enforced', async ({ page }) => {
  await openAccount(page, {
    path: '/admin',
    health: { email: 'ops@example.com', emailDeliverable: true, secondFactor: 'enforced', adminOrigin: true },
  });
  await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin site' })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('the account page shows the current email and whether it can receive email', async ({ page }) => {
  await openAccount(page);
  await expect(page).toHaveTitle(/Your admin account · MusiLynk Admin/);
  await expect(page.getByTestId('admin-current-email')).toHaveText(admin.email);
  await expect(page.getByText('Cannot receive email', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Your account' })).toHaveAttribute('aria-current', 'page');
});

test('changing the admin email: refused addresses are explained, then the emailed code confirms it', async ({
  page,
}) => {
  const calls = await openAccount(page);
  const field = page.getByLabel('New email address');

  await field.fill('admin@musilynk.local');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('alert')).toHaveText('That address can never receive email. Use a real mailbox.');
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('taken@example.com');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('alert')).toHaveText('Another account already uses that email.');

  await field.fill('ops@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const code = page.getByLabel('Confirmation code');
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(page.getByText('We emailed a 6-digit code to ops@example.com. It expires in 10 minutes.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();

  await code.fill('000000');
  await expect(page.getByRole('alert')).toHaveText('That code is not right. Check the email and try again.');
  await expect(code).toHaveValue('');
  await expect(code).toBeFocused();

  await code.fill(VALID_CODE);
  await expect(page.getByRole('status').filter({ hasText: 'Your admin email is now ops@example.com' })).toBeVisible();
  await expect(page.getByTestId('admin-current-email')).toHaveText('ops@example.com');
  await expect(page.getByText('Can receive email', { exact: true })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  expect(calls.requests).toEqual([
    { email: 'admin@musilynk.local' },
    { email: 'taken@example.com' },
    { email: 'ops@example.com' },
  ]);
  expect(calls.confirms).toEqual([
    { changeToken: 'change-3', code: '000000' },
    { changeToken: 'change-3', code: VALID_CODE },
  ]);
  expect(await page.evaluate(() => localStorage.getItem('musilynk_access_token'))).toBe('qa-admin-token');
});

test('an expired email change goes back to the address with the reason', async ({ page }) => {
  await openAccount(page);
  await page.getByLabel('New email address').fill('ops@example.com');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Confirmation code').fill(EXPIRED_CODE);
  await expect(page.getByRole('alert')).toHaveText(EXPIRED_MESSAGE);
  await expect(page.getByLabel('Confirmation code')).toHaveCount(0);
  await expect(page.getByLabel('New email address')).toBeFocused();
  await expect(page.getByLabel('New email address')).toHaveValue('ops@example.com');
});

test('changing the password checks the new one locally, then reports the API answer inline', async ({ page }) => {
  const calls = await openAccount(page);
  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  const again = page.getByLabel('Confirm new password');
  const submit = page.getByRole('button', { name: 'Change password' });

  await current.fill('WrongPass123!');
  await next.fill('short');
  await again.fill('short');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Use at least 10 characters for the new password.');
  await expect(next).toBeFocused();

  await next.fill('NewAdminPass2026!');
  await again.fill('NewAdminPass2026?');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('The new passwords do not match.');
  await expect(again).toBeFocused();

  await again.fill('NewAdminPass2026!');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Your current password is incorrect.');
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('aria-invalid', 'true');

  await current.fill('CurrentPass123!');
  await submit.click();
  await expect(page.getByText('Password changed. Your other admin sessions were signed out.')).toBeVisible();
  await expect(current).toHaveValue('');
  expect(calls.passwords).toEqual([
    { currentPassword: 'WrongPass123!', newPassword: 'NewAdminPass2026!' },
    { currentPassword: 'CurrentPass123!', newPassword: 'NewAdminPass2026!' },
  ]);
  expect(await page.evaluate(() => localStorage.getItem('musilynk_access_token'))).toBe('qa-admin-token');
});

test('the account page fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAccount(page);
  await expect(page.getByRole('heading', { name: 'Your admin account' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
