import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for the "confirm your email first" answer to a password sign-in.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const MESSAGE =
  'Confirm your email address before signing in with a password. We can send the link again, or you can sign in with an emailed code.';

async function mockApi(page: Page) {
  const calls = { resend: [] as unknown[], otp: [] as unknown[] };
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/auth/login')) {
      return json(403, { error: MESSAGE, code: 'EMAIL_VERIFICATION_REQUIRED' });
    }
    if (pathname.endsWith('/auth/resend-verification')) {
      calls.resend.push(request.postDataJSON());
      return json(200, { ok: true, message: 'If this email can be used on Verse, a confirmation link is on its way.' });
    }
    if (pathname.endsWith('/auth/otp/request')) {
      calls.otp.push(request.postDataJSON());
      return json(200, { ok: true, message: 'sent', expiresIn: 600 });
    }
    if (pathname.endsWith('/auth/methods')) return json(200, { signInCodes: true, password: true });
    if (pathname.endsWith('/me')) return json(401, { error: 'Authentication required' });
    return json(200, {});
  });
  return calls;
}

async function reachUnverified(page: Page) {
  await page.goto('/auth/jobseeker');
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await page.getByLabel('Email').fill('new@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('SomePassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('an unconfirmed email shows the message and lets the person resend the link', async ({ page }) => {
  const calls = await mockApi(page);
  await reachUnverified(page);
  await expect(page.getByRole('alert')).toHaveText(MESSAGE);
  await page.getByRole('button', { name: 'Send the link again' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'If this email can be used on Verse, a confirmation link is on its way.',
  );
  expect(calls.resend).toEqual([{ email: 'new@example.invalid' }]);
});

test('"Email me a code instead" switches to the code flow with the email prefilled', async ({ page }) => {
  const calls = await mockApi(page);
  await reachUnverified(page);
  await page.getByRole('button', { name: 'Email me a code instead' }).first().click();
  await expect(page.getByLabel('Email')).toHaveValue('new@example.invalid');
  await expect(page.getByText(MESSAGE)).toHaveCount(0);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  expect(calls.otp).toEqual([{ email: 'new@example.invalid' }]);
});
