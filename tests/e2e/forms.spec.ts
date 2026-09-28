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
