import { expect, test, type Page, type Request } from '@playwright/test';

// Mocked-API checks for /jobseeker/settings: name, email (code to the new address) and
// password changes (C1/FORM-13).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const me = {
  id: 'qa-settings',
  name: 'Asha Rao',
  email: 'asha@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

type Reply = { status?: number; body: unknown };

async function signIn(page: Page, handler: (request: Request, pathname: string) => Reply | undefined) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let reply = handler(request, pathname);
    if (!reply && pathname.endsWith('/me')) reply = { body: { user: me } };
    reply ??= { body: {} };
    return route.fulfill({
      status: reply.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
  return errors;
}

test('changing the name saves it', async ({ page }) => {
  let sentName: unknown;
  const errors = await signIn(page, (request, path) => {
    if (path !== '/api/account/name') return undefined;
    sentName = request.postDataJSON();
    return { body: { user: { ...me, name: 'Asha R. Rao' } } };
  });
  await page.goto('/jobseeker/settings');
  await page.getByLabel('Full name').fill('Asha R. Rao');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Name updated')).toBeVisible();
  expect(sentName).toEqual({ name: 'Asha R. Rao' });
  expect(errors).toEqual([]);
});

test('changing the email requests a code, then confirms it and signs out other sessions', async ({ page }) => {
  let requested: unknown;
  let confirmed: unknown;
  const errors = await signIn(page, (request, path) => {
    if (path === '/api/account/email/request') {
      requested = request.postDataJSON();
      return {
        status: 202,
        body: { changeToken: 'change-token-abc', expiresIn: 600, message: 'We emailed a 6-digit code.', debugCode: '042917' },
      };
    }
    if (path === '/api/account/email/confirm') {
      confirmed = request.postDataJSON();
      return { body: { user: { ...me, email: 'new@example.invalid', emailVerified: true } } };
    }
    return undefined;
  });
  await page.goto('/jobseeker/settings');
  await page.getByLabel('New email address').fill('new@example.invalid');
  await page.getByRole('button', { name: 'Send code to new address' }).click();
  expect(requested).toEqual({ email: 'new@example.invalid' });
  await expect(page.getByTestId('debug-code')).toHaveText('042917');

  await page.getByLabel('6-digit code').fill('042917');
  await page.getByRole('button', { name: 'Confirm new email' }).click();
  await expect(page.getByText('Email address updated. Other sessions were signed out.')).toBeVisible();
  expect(confirmed).toEqual({ changeToken: 'change-token-abc', code: '042917' });
  expect(errors).toEqual([]);
});

test('an invalid email-change code is shown inline and the field is cleared', async ({ page }) => {
  await signIn(page, (_request, path) => {
    if (path === '/api/account/email/request') {
      return { status: 202, body: { changeToken: 'token', expiresIn: 600, message: 'sent' } };
    }
    if (path === '/api/account/email/confirm') {
      return { status: 422, body: { error: 'Invalid or expired code.', code: 'OTP_INVALID' } };
    }
    return undefined;
  });
  await page.goto('/jobseeker/settings');
  await page.getByLabel('New email address').fill('new@example.invalid');
  await page.getByRole('button', { name: 'Send code to new address' }).click();
  await page.getByLabel('6-digit code').fill('111111');
  await page.getByRole('button', { name: 'Confirm new email' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid or expired code.');
  await expect(page.getByLabel('6-digit code')).toHaveValue('');
});

test('the password checklist gates the button and a wrong current password is shown inline', async ({ page }) => {
  await signIn(page, (_request, path) =>
    path === '/api/account/password' ? { status: 403, body: { error: 'Your current password is incorrect.', code: 'PASSWORD_INCORRECT' } } : undefined,
  );
  await page.goto('/jobseeker/settings');
  const updateButton = page.getByRole('button', { name: 'Update password' });
  await page.getByLabel('Current password').fill('wrong-current');
  await page.getByLabel('New password').fill('short');
  await expect(updateButton).toBeDisabled();
  await page.getByLabel('New password').fill('BrandNewPass456!');
  await expect(updateButton).toBeEnabled();
  await updateButton.click();
  await expect(page.getByRole('alert')).toHaveText('Your current password is incorrect.');
});

test('a strong password change succeeds', async ({ page }) => {
  const errors = await signIn(page, (_request, path) => (path === '/api/account/password' ? { body: { ok: true } } : undefined));
  await page.goto('/jobseeker/settings');
  await page.getByLabel('Current password').fill('CurrentPass123!');
  await page.getByLabel('New password').fill('BrandNewPass456!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated. Other sessions were signed out.')).toBeVisible();
  expect(errors).toEqual([]);
});
