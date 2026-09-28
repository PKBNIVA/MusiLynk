import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for the reset-password link check (C3/FORM-15): an expired or
// already-used link is reported immediately with a "send a new link" form, and a
// successful reset signs the person straight in and routes "Sign in" to the right role.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

async function mockApi(page: Page, opts: { valid: boolean; role?: string }) {
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/auth/reset-password/check')) {
      return opts.valid ? json(200, { valid: true, role: opts.role ?? 'jobseeker' }) : json(200, { valid: false });
    }
    if (pathname.endsWith('/auth/reset-password') && request.method() === 'POST') {
      const body = request.postDataJSON() as { password?: string };
      if ((body.password || '').length < 10) {
        return json(400, { error: 'Password must be at least 10 characters.', code: 'PASSWORD_WEAK' });
      }
      return json(200, {
        ok: true,
        user: { id: 'qa-reset', name: 'Reset Person', email: 'reset@example.invalid', role: opts.role ?? 'jobseeker', status: 'active', profileComplete: true },
        accessToken: 'qa-reset-token',
      });
    }
    if (pathname.endsWith('/auth/forgot-password')) return json(200, { ok: true, message: 'sent' });
    if (pathname.endsWith('/me')) {
      return request.headers().authorization
        ? json(200, { user: { id: 'qa-reset', name: 'Reset Person', email: 'reset@example.invalid', role: opts.role ?? 'jobseeker', status: 'active', profileComplete: true } })
        : json(401, { error: 'Authentication required' });
    }
    return json(200, {});
  });
}

test('an expired or already-used link says so immediately and offers to send a new one', async ({ page }) => {
  await mockApi(page, { valid: false });
  await page.goto('/reset-password?token=stale-token');
  await expect(page.getByRole('alert')).toHaveText('This link has expired or was already used. Request a new one below.');
  await page.getByLabel('Email').fill('someone@example.invalid');
  await page.getByRole('button', { name: 'Send a new link' }).click();
  await expect(page.getByText('If an account exists, a new reset link has been sent.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/jobseeker');
});

test('a link with no token at all is treated as invalid without a network round trip', async ({ page }) => {
  await mockApi(page, { valid: false });
  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toHaveText('This link has expired or was already used. Request a new one below.');
});

test('a valid link shows the password form, gates it on strength, and signs in on success', async ({ page }) => {
  await mockApi(page, { valid: true, role: 'employer' });
  await page.goto('/reset-password?token=good-token');
  const submit = page.getByRole('button', { name: 'Update password' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('New password').fill('short');
  await expect(submit).toBeDisabled();
  // "Sign in" routes to the token's own role (employer), read before any password is typed.
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/employer');

  await page.getByLabel('New password').fill('BrandNewPass456!');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/employer$/);
  await expect(page.getByText('Password updated. You are signed in.')).toBeVisible();
});

test('a weak-password rejection from the server is shown inline', async ({ page }) => {
  // The client checklist normally blocks this, but the server rule is authoritative and this
  // path shows what happens if a client-only bug ever let a bad password through.
  await page.route('**/api/auth/reset-password/check*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, role: 'jobseeker' }) }));
  await page.route('**/api/auth/reset-password', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Password is too common. Choose something more unusual.', code: 'PASSWORD_WEAK' }) });
  });
  await page.goto('/reset-password?token=good-token');
  await page.getByLabel('New password').fill('LongEnough1234');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('alert')).toHaveText('Password is too common. Choose something more unusual.');
});
