import { expect, test, type Page, type Request } from '@playwright/test';

// Shared form pattern (components/form/Field + lib/formErrors): errors appear next to their
// field with aria-invalid and role=alert, focus moves to the first invalid field, entered data
// is kept, server `fields` land on the right input, and a double click sends one request.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

type Role = 'jobseeker' | 'employer';
type Reply = { status?: number; body: unknown; delayMs?: number } | undefined;
type Handler = (request: Request, path: string) => Reply;
type Call = { method: string; path: string; body: unknown };

async function signIn(page: Page, role: Role, handler: Handler = () => undefined, user: object = {}) {
  const calls: Call[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((r) => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem(`verse-tour-v2-${r}`, 'done');
  }, role);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    calls.push({ method: request.method(), path, body });
    const custom = handler(request, path);
    if (custom) {
      if (custom.delayMs) await new Promise((resolve) => setTimeout(resolve, custom.delayMs));
      return route.fulfill({ status: custom.status ?? 200, json: custom.body });
    }
    if (path === '/me')
      return route.fulfill({
        json: {
          user: {
            id: `qa-${role}`,
            name: 'QA User',
            email: 'qa@example.invalid',
            role,
            status: 'active',
            profileComplete: true,
            ...user,
          },
        },
      });
    if (path === '/notifications/unread') return route.fulfill({ json: { unread: 0 } });
    return route.fulfill({ json: {} });
  });
  return { calls, errors };
}

test.describe('organization profile (the shared form pattern)', () => {
  test('an empty submit shows the required error inline, focuses the field and sends nothing', async ({ page }) => {
    const { calls, errors } = await signIn(page, 'employer');
    await page.goto('/employer/profile');
    const name = page.getByLabel(/Company \/ label \/ studio name/);
    await expect(name).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('label[for="org-companyName"]')).toContainText('*');
    await page.getByLabel('Contact phone').fill('abc-😀');
    await page.getByRole('button', { name: 'Save organization profile' }).click();

    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    const error = page.locator('#org-companyName-error');
    await expect(error).toHaveText('Enter your company, label or studio name.');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(name).toHaveAttribute('aria-describedby', /org-companyName-error/);
    await expect(page.getByLabel('Contact phone')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Contact phone')).toHaveValue('abc-😀');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);

    await name.fill('Blue Room Studios');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(error).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('server field errors land on their inputs; a double click sends one request', async ({ page }) => {
    let puts = 0;
    const { calls } = await signIn(
      page,
      'employer',
      (request, path) => {
        if (path !== '/profile' || request.method() !== 'PUT') return undefined;
        puts += 1;
        if (puts === 1)
          return {
            status: 422,
            delayMs: 300,
            body: {
              error: 'Company website must be a valid HTTP or HTTPS URL',
              code: 'VALIDATION_FAILED',
              fields: { companyWebsite: ['Company website must be a valid HTTP or HTTPS URL'] },
            },
          };
        return { body: { user: { id: 'qa-employer', role: 'employer', companyName: 'Blue Room Studios' } } };
      },
      { companyName: 'Blue Room Studios', companyWebsite: 'https://blue.example' },
    );
    await page.goto('/employer/profile');
    await expect(page.getByLabel(/Company \/ label/)).toHaveValue('Blue Room Studios');
    const save = page.getByRole('button', { name: 'Save organization profile' });
    // Three clicks in one task: only a ref-based guard stops the second and third.
    await save.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
      button.click();
    });
    const website = page.getByLabel('Official website');
    await expect(website).toBeFocused();
    await expect(website).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#org-companyWebsite-error')).toHaveText(
      'Company website must be a valid HTTP or HTTPS URL',
    );
    expect(calls.filter((c) => c.method === 'PUT' && c.path === '/profile')).toHaveLength(1);
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

    await website.fill('https://blueroom.example');
    await save.click();
    await expect(page.getByText('Organization profile saved')).toBeVisible();
    expect(calls.filter((c) => c.method === 'PUT' && c.path === '/profile')).toHaveLength(2);
  });

  test('a failure that names no field is shown above the button, not as a toast', async ({ page }) => {
    await signIn(
      page,
      'employer',
      (request, path) =>
        path === '/profile' && request.method() === 'PUT'
          ? { status: 409, body: { error: 'This profile changed in another tab. Reload and try again.' } }
          : undefined,
      { companyName: 'Blue Room Studios' },
    );
    await page.goto('/employer/profile');
    await expect(page.getByLabel(/Company \/ label/)).toHaveValue('Blue Room Studios');
    await page.getByRole('button', { name: 'Save organization profile' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'changed in another tab' })).toBeVisible();
  });
});

test.describe('forms using the shared pattern', () => {
  test('career profile: typed inputs, all errors at once, first invalid focused, long bio wraps', async ({ page }) => {
    const { calls } = await signIn(page, 'jobseeker', undefined, { headline: 'Session bassist' });
    await page.goto('/jobseeker/profile');
    await expect(page.getByLabel('Professional headline')).toHaveValue('Session bassist');
    await expect(page.getByLabel('Website')).toHaveAttribute('type', 'url');
    await expect(page.getByLabel('Phone')).toHaveAttribute('type', 'tel');
    await expect(page.getByLabel('Phone')).toHaveAttribute('autocomplete', 'tel');
    await expect(page.getByLabel('Bio')).toHaveAttribute('maxlength', '2000');

    await page.getByLabel('Website').fill('not a url');
    await page.getByLabel('Phone').fill('abc-😀');
    await page.getByRole('button', { name: /More rates/ }).click();
    await page.getByLabel('Hourly rate').fill('-5');
    await page.getByRole('button', { name: 'Save career profile' }).click();
    // Rates come before Links on the page, so the hourly rate is the first invalid field.
    await expect(page.getByLabel('Hourly rate')).toBeFocused();
    for (const label of ['Website', 'Phone', 'Hourly rate'])
      await expect(page.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#profile-website-error')).toHaveText('Enter a full web address starting with https://');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);

    await page.getByLabel('Bio').fill('https://www.youtube.com/watch?v=' + 'x'.repeat(400));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('apply: every screening question is labelled and required; answers are sent in order', async ({ page }) => {
    const job = {
      id: 'job-1',
      title: 'Session bassist',
      company: 'Blue Room',
      location: 'Pune',
      status: 'published',
      description: 'Record bass for a six-song indie EP over three days with the band and producer in Pune.',
      skills: [],
      screeningQuestions: ['Do you read charts?', 'Which rig do you own?'],
    };
    const { calls } = await signIn(page, 'jobseeker', (request, path) => {
      if (path === '/jobs/job-1' && request.method() === 'GET') return { body: { job } };
      if (path === '/jobs/job-1/apply') return { status: 201, body: { id: 'app-1', status: 'Applied' } };
      return undefined;
    });
    await page.goto('/jobseeker/jobs/job-1');
    const first = page.getByLabel('Do you read charts?');
    await expect(first).toHaveAttribute('aria-required', 'true');
    await page.getByLabel('Which rig do you own?').fill('Fender Jazz V');
    await page.getByRole('button', { name: 'Apply now' }).click();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((c) => c.path === '/jobs/job-1/apply')).toEqual([]);

    await first.fill('Yes');
    await page.getByRole('button', { name: 'Apply now' }).click();
    await expect(page.getByText('Application submitted').first()).toBeVisible();
    const post = calls.find((c) => c.path === '/jobs/job-1/apply');
    expect(post?.body).toMatchObject({ screeningAnswers: ['Yes', 'Fender Jazz V'] });
  });

  test('availability: end before start and past slots are explained inline', async ({ page }) => {
    const { calls } = await signIn(page, 'jobseeker', (_r, path) =>
      path === '/availability' ? { body: { windows: [] } } : undefined,
    );
    await page.goto('/jobseeker/availability');
    await page.getByLabel(/^Start/).fill('2020-01-10T20:00');
    await page.getByLabel(/^End/).fill('2020-01-10T18:00');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('#availability-start-error')).toHaveText('Choose a start time in the future.');
    await expect(page.locator('#availability-end-error')).toHaveText('End must be after the start.');
    await expect(page.getByLabel(/^Start/)).toBeFocused();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  test('create act: visible labels and fee errors next to the fields', async ({ page }) => {
    await signIn(page, 'jobseeker', (_r, path) => (path === '/acts/me' ? { body: { acts: [] } } : undefined));
    await page.goto('/jobseeker/acts');
    await expect(page.locator('label[for="act-lineupSize"]')).toHaveText('Lineup size');
    await expect(page.locator('label[for="act-ownerRole"]')).toHaveText('Your role');
    await page.getByRole('button', { name: /Create bookable act/ }).click();
    await expect(page.getByLabel(/Act \/ stage name/)).toBeFocused();
    await page.getByLabel(/Act \/ stage name/).fill('The Monsoon Collective');
    await page.getByRole('button', { name: 'Fees & lineup (optional)' }).click();
    await page.getByLabel('Min fee (₹)').fill('50000');
    await page.getByLabel('Max fee (₹)').fill('10000');
    await page.getByRole('button', { name: /Create bookable act/ }).click();
    await expect(page.locator('#act-maxFee-error')).toHaveText('Max fee must be at least the min fee.');
  });

  test('password sign-in: a wrong password is shown inline and three clicks send one request', async ({ page }) => {
    let logins = 0;
    await page.route('**/api/auth/methods', (route) =>
      route.fulfill({ json: { password: true, signInCodes: true, emailDelivery: true } }),
    );
    await page.route('**/api/auth/login', async (route) => {
      logins += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.fulfill({ status: 401, json: { error: 'Incorrect email or password.' } });
    });
    await page.goto('/auth/jobseeker');
    await page.getByRole('button', { name: 'Use password instead' }).click();
    await page.getByLabel('Email').fill('qa@example.invalid');
    await page.locator('#auth-password').fill('WrongPassword1');
    await page.getByRole('button', { name: /^Sign in$/ }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
      button.click();
    });
    await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');
    await expect(page.locator('#auth-password')).toBeFocused();
    await expect(page.locator('#auth-password')).toHaveAttribute('aria-invalid', 'true');
    expect(logins).toBe(1);
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  });
});
