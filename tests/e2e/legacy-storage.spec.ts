import { expect, test } from '@playwright/test';

// Visitors who signed in before the MusiLynk rename still have their session under the old
// browser-storage keys. The app moves them on load, so nobody is signed out by the rename.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

test('a visitor signed in under the old storage keys stays signed in and the keys are renamed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  });
  let sentToken: string | null = null;
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (path === '/me') sentToken = request.headers()['authorization'] ?? null;
    const body =
      path === '/me'
        ? {
            user: {
              id: 'me-1',
              name: 'Asha Rao',
              email: 'asha@example.invalid',
              role: 'jobseeker',
              status: 'active',
              profileComplete: true,
            },
          }
        : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/jobseeker');
  await expect(page.getByRole('button', { name: /Open account menu/ })).toBeVisible();
  expect(sentToken).toBe('Bearer qa-token');
  const stored = await page.evaluate(() => ({
    token: localStorage.getItem('musilynk_access_token'),
    tour: localStorage.getItem('musilynk-tour-v2-jobseeker'),
  }));
  expect(stored).toEqual({ token: 'qa-token', tour: 'done' });
});
