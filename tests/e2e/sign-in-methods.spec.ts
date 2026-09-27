import {expect, test, type Page} from '@playwright/test';

// The sign-in page must never promise an emailed code or reset link that the API cannot deliver.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const user = {id: 'qa-jobseeker', name: 'QA User', email: 'qa@example.invalid', role: 'jobseeker', status: 'active', profileComplete: true};

async function mockApi(page: Page, methods: Record<string, boolean> | 'error', otp: {status: number; body: unknown} = {status: 200, body: {ok: true, expiresIn: 600}}) {
  const calls = {otp: 0, login: 0};
  await page.addInitScript(() => localStorage.setItem('verse-tour-v2-jobseeker', 'done'));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (pathname.endsWith('/auth/methods')) return methods === 'error' ? json(500, {error: 'boom'}) : json(200, methods);
    if (pathname.endsWith('/auth/otp/request')) { calls.otp += 1; return json(otp.status, otp.body); }
    if (pathname.endsWith('/auth/login')) { calls.login += 1; return json(200, {user, accessToken: 'qa-token'}); }
    if (pathname.endsWith('/me')) return request.headers().authorization ? json(200, {user}) : json(401, {error: 'Authentication required'});
    if (pathname.endsWith('/notifications/unread')) return json(200, {unread: 0});
    return json(200, {});
  });
  return calls;
}

test('without email delivery the page opens on password sign-in and hides code and reset links', async ({page}) => {
  const calls = await mockApi(page, {signInCodes: false, password: true, emailDelivery: false});
  await page.goto('/auth/jobseeker');
  await expect(page.getByLabel('Password', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Email me a sign-in code'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Email me a code instead'})).toHaveCount(0);
  await expect(page.getByRole('link', {name: 'Forgot password?'})).toHaveCount(0);

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', {exact: true}).fill('StrongPass123!');
  await page.getByRole('button', {name: /sign in/i}).click();
  await expect(page).toHaveURL(/\/jobseeker/);
  expect(calls).toEqual({otp: 0, login: 1});
});

test('with email delivery the code flow stays the default and the reset link is offered', async ({page}) => {
  await mockApi(page, {signInCodes: true, password: true, emailDelivery: true});
  await page.goto('/auth/jobseeker');
  await expect(page.getByRole('button', {name: 'Email me a sign-in code'})).toBeVisible();
  await page.getByRole('button', {name: 'Use password instead'}).click();
  await expect(page.getByRole('link', {name: 'Forgot password?'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Email me a code instead'})).toBeVisible();
});

test('if the methods check fails, both paths remain and an OTP_UNAVAILABLE reply switches to password', async ({page}) => {
  const calls = await mockApi(page, 'error', {status: 503, body: {error: 'Email sign-in codes are temporarily unavailable. Use your password instead.', code: 'OTP_UNAVAILABLE'}});
  await page.goto('/auth/jobseeker');
  await page.getByLabel('Email').fill(user.email);
  await page.getByRole('button', {name: 'Email me a sign-in code'}).click();
  await expect(page.getByText('Email sign-in codes are temporarily unavailable. Use your password instead.').first()).toBeVisible();
  await expect(page.getByLabel('Password', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Email me a code instead'})).toHaveCount(0);
  await expect(page.getByText('Check your email')).toHaveCount(0);
  expect(calls.otp).toBe(1);
});
