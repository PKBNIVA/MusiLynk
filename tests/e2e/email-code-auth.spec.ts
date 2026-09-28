import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage for the email sign-in code flow on the auth page.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const jobseeker = {
  id: 'qa-jobseeker',
  name: 'QA User',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
const employer = {
  id: 'qa-employer',
  name: 'QA Studio',
  email: 'studio@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: false,
};
const GENERIC = {
  ok: true,
  message: 'If this email can be used on Verse, a 6-digit code is on its way.',
  expiresIn: 600,
};

interface Calls {
  requests: Record<string, unknown>[];
  verifies: Record<string, unknown>[];
  /** Only set when `holdRequest` is passed to `mockApi`: releases a pending "sending code" response. */
  release?: () => void;
}

async function mockApi(page: Page, opts: { user?: typeof jobseeker; validCode?: string; holdRequest?: boolean } = {}) {
  const calls: Calls = { requests: [], verifies: [] };
  const user = opts.user ?? jobseeker;
  const validCode = opts.validCode ?? '482913';
  // `holdRequest` lets a test hold the mocked "sending code" response open on demand (via
  // `calls.release()`) instead of racing a fixed real-time delay against its assertions —
  // deterministic under any amount of CPU load, unlike a delay a slow machine could outrun.
  let release: (() => void) | null = null;
  calls.release = () => release?.();
  await page.addInitScript((role) => localStorage.setItem(`verse-tour-v2-${role}`, 'done'), user.role);
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/auth/otp/request')) {
      calls.requests.push(request.postDataJSON());
      if (opts.holdRequest) await new Promise<void>((resolve) => (release = resolve));
      return json(200, GENERIC);
    }
    if (pathname.endsWith('/auth/otp/verify')) {
      const body = request.postDataJSON();
      calls.verifies.push(body);
      return body.code === validCode
        ? json(200, { user, accessToken: 'qa-otp-token' })
        : json(401, { error: 'Invalid or expired code.', code: 'OTP_INVALID' });
    }
    if (pathname.endsWith('/me')) {
      return request.headers().authorization ? json(200, { user }) : json(401, { error: 'Authentication required' });
    }
    if (pathname.endsWith('/notifications/unread')) return json(200, { unread: 0 });
    if (pathname.endsWith('/notifications')) return json(200, { notifications: [], unread: 0 });
    return json(200, {});
  });
  return calls;
}

async function pasteCode(page: Page, code: string) {
  const input = page.getByLabel('Sign-in code');
  await input.focus();
  await input.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, code);
}

test('email code is the primary sign-in and a pasted code signs in', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/auth/jobseeker');
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);

  await page.getByLabel('Email').fill('qa@example.invalid');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByLabel('Sign-in code')).toBeFocused();
  expect(calls.requests).toEqual([{ email: 'qa@example.invalid' }]);

  await pasteCode(page, 'Your code: 482 913');
  await expect(page).toHaveURL(/\/jobseeker$/);
  expect(calls.verifies).toEqual([{ email: 'qa@example.invalid', code: '482913' }]);
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBe('qa-otp-token');
});

test('a wrong code shows an error, clears the input and allows a retry', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/auth/jobseeker');
  await page.getByLabel('Email').fill('qa@example.invalid');
  await page.getByLabel('Email').press('Enter');

  await page.getByLabel('Sign-in code').fill('111111');
  await expect(page.getByRole('alert')).toHaveText('Invalid or expired code.');
  await expect(page.getByLabel('Sign-in code')).toHaveValue('');
  await expect(page.getByLabel('Sign-in code')).toBeFocused();

  await page.getByLabel('Sign-in code').pressSequentially('48291');
  await expect(page.getByRole('button', { name: 'Verify and sign in' })).toBeDisabled();
  await page.getByLabel('Sign-in code').press('3');
  await expect(page).toHaveURL(/\/jobseeker$/);
  expect(calls.verifies.map((v) => v.code)).toEqual(['111111', '482913']);
});

test('resend waits 60 seconds and sending shows a busy state', async ({ page }) => {
  await page.clock.install();
  // The first request is held open on purpose, so the busy state below is observed by design —
  // not by winning a race against a fixed delay — and is exactly as reliable on a loaded CI box
  // as on an idle one.
  const calls = await mockApi(page, { holdRequest: true });
  await page.goto('/auth/jobseeker');
  await page.getByLabel('Email').fill('qa@example.invalid');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByRole('button', { name: 'Sending code…' })).toBeDisabled();
  await expect.poll(() => calls.requests.length).toBe(1);
  calls.release?.();

  const resend = page.getByRole('button', { name: /Resend code/ });
  await expect(resend).toHaveText('Resend code in 60s');
  await expect(resend).toBeDisabled();
  await page.clock.runFor(30_000);
  await expect(resend).toHaveText(/Resend code in 3\ds/);
  await page.clock.runFor(31_000);
  await expect(resend).toHaveText('Resend code');
  await resend.click();
  await expect.poll(() => calls.requests.length).toBe(2);
  await expect(resend).toBeDisabled();
  calls.release?.();

  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('qa@example.invalid');
});

test('sign-up by code (on /join) sends name, role and consent and lands on the dashboard', async ({ page }) => {
  const calls = await mockApi(page, { user: employer });
  await page.goto('/auth/employer');
  await page.getByRole('link', { name: 'New to Verse? Join in two minutes' }).click();
  await expect(page).toHaveURL(/\/join\/hiring$/);
  await page.getByRole('button', { name: 'Complete my profile later' }).click();
  await page.getByLabel('Your name').fill('QA Studio');
  await page.getByLabel('Email').fill('studio@example.invalid');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect
    .poll(() => calls.requests)
    .toEqual([{ email: 'studio@example.invalid', name: 'QA Studio', role: 'employer', consent: true }]);

  await page.getByLabel('Sign-in code').fill('482913');
  await expect(page).toHaveURL(/\/employer\?welcome=1$/);
});

test('password sign-in remains available as a secondary path', async ({ page }) => {
  await mockApi(page);
  await page.goto('/auth/jobseeker');
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await page.getByRole('button', { name: 'Email me a code instead' }).click();
  await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeVisible();
});
