import { expect, test } from '@playwright/test';
import { mockSignupApi } from './support/signup-fixtures';

// The four signup-funnel events the admin Funnel tab reads (path_chosen, signup_started,
// signup_completed, profile_link_added) reach POST /api/events from the landing and join pages.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const PASSWORD = 'Harbor-Lantern-4827!';

test('landing path, join start and account creation are tracked', async ({ page }) => {
  await mockSignupApi(page);
  const events: Array<{ name: string; props: Record<string, unknown> }> = [];
  // Registered after the shared mock, so it answers /api/events first.
  await page.route('**/api/events', async (route) => {
    events.push(...(route.request().postDataJSON() as { events: typeof events }).events);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/');
  await page
    .getByTestId('hero-paths')
    .getByRole('link', { name: /I'm hiring/ })
    .click();
  await expect(page).toHaveURL(/\/join\/hiring$/);
  await page.getByLabel('Event or wedding company').check();
  await page.getByLabel('Company name').fill('Shaadi Beats Events');
  await page.getByRole('button', { name: 'Next: your account' }).click();
  await page.getByLabel('Your name').fill('Anita Kulkarni');
  await page.getByLabel('Email').fill('anita@example.invalid');
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL(/\/employer\?welcome=1$/);

  // The queue flushes every 5 s (or on page hide).
  await expect.poll(() => events.map((event) => event.name), { timeout: 15_000 }).toContain('signup_completed');
  const named = (name: string) => events.filter((event) => event.name === name);
  expect(named('path_chosen')[0]?.props).toMatchObject({ path: 'hire' });
  expect(named('signup_started')).toHaveLength(1);
  expect(named('signup_started')[0]?.props).toMatchObject({ role: 'employer' });
  expect(named('signup_completed')[0]?.props).toMatchObject({ role: 'employer' });
});

test('a Google sign-up returning to the join page counts as signup_completed once', async ({ page }) => {
  await mockSignupApi(page);
  const events: Array<{ name: string; props: Record<string, unknown> }> = [];
  let signedIn = false;
  await page.route('**/api/events', async (route) => {
    events.push(...(route.request().postDataJSON() as { events: typeof events }).events);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/auth/exchange', async (route) => {
    signedIn = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"accessToken":"qa-google-token"}' });
  });
  await page.route('**/api/me', async (route) => {
    if (!signedIn)
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"error":"Authentication required"}',
      });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'qa-google-user',
          name: 'Riya Desai',
          email: 'riya@example.invalid',
          role: 'jobseeker',
          status: 'active',
          profileComplete: false,
        },
      }),
    });
  });

  // GoogleAuthController redirects a new account to its join page with a one-time code.
  await page.goto('/join/musician?auth=google&code=one-time-code');
  await expect(page).toHaveURL(/\/jobseeker/);
  await expect.poll(() => events.map((event) => event.name), { timeout: 15_000 }).toContain('signup_completed');
  const named = (name: string) => events.filter((event) => event.name === name);
  expect(named('signup_completed')).toHaveLength(1);
  expect(named('signup_completed')[0]?.props).toMatchObject({ role: 'jobseeker', method: 'google' });
  expect(named('signup_started')).toHaveLength(0);
});
