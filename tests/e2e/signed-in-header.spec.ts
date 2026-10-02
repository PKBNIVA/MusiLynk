import { expect, test, type Page } from '@playwright/test';

// A-20: at a 360px viewport the signed-in header (brand, identity switcher, bell, account menu and
// the workspace menu button) must fit, so the hamburger is on screen and the page does not scroll
// sideways. The switcher only shows for people who run a Page, so the fixture gives them one.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');
test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

type Role = 'jobseeker' | 'employer';

async function signIn(page: Page, role: Role) {
  await page.addInitScript(() => {
    localStorage.setItem('musilynk_access_token', 'qa-token');
    for (const key of ['musilynk-tour-v2-jobseeker', 'musilynk-tour-v2-employer']) localStorage.setItem(key, 'done');
  });
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith('/me/identities')
      ? {
          identities: [
            { type: 'user', id: 'qa', name: 'Priyanka Venkataraman', key: 'user:qa' },
            { type: 'act', id: 'a1', name: 'The Weekend Band', key: 'act:a1' },
          ],
        }
      : pathname.endsWith('/me')
        ? {
            user: {
              id: 'qa',
              name: 'Priyanka Venkataraman',
              email: 'qa@example.invalid',
              role,
              status: 'active',
              profileComplete: true,
            },
          }
        : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const role of ['jobseeker', 'employer'] as const) {
  test(`the ${role} header keeps the menu button on screen at 360px`, async ({ page }) => {
    await signIn(page, role);
    await page.goto(`/${role}`);
    await expect(page.getByTestId('identity-switcher')).toBeVisible();
    const menu = page.getByRole('button', { name: 'Open all workspace tools' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
    await menu.click();
    await expect(page.getByRole('menuitem', { name: 'Messages' })).toBeVisible();
  });
}
