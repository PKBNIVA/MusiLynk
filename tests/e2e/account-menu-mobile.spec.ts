import { expect, test, type Page } from '@playwright/test';

// The account menu on a phone: its items scroll, "Sign out" sits below them and never covers one.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

async function openAccountMenu(page: Page, role: 'jobseeker' | 'employer') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const body =
      path === '/me'
        ? {
            user: {
              id: 'me-1',
              name: 'Asha Rao',
              email: 'asha@example.invalid',
              role,
              status: 'active',
              profileComplete: true,
            },
          }
        : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/${role}`);
  await page.getByRole('button', { name: /Open account menu/ }).click();
  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Sign out' }) });
  await expect(menu).toBeVisible();
  return menu;
}

for (const role of ['jobseeker', 'employer'] as const) {
  test(`${role}: every account menu item is reachable at 390px and Sign out covers none of them`, async ({ page }) => {
    const menu = await openAccountMenu(page, role);
    const items = menu.getByTestId('account-menu-items');
    const guide = menu.getByRole('menuitem', { name: 'How to use MusiLynk' });
    const signOut = menu.getByRole('menuitem', { name: 'Sign out' });

    // Sign out is on screen at once, inside the viewport.
    await expect(signOut).toBeInViewport({ ratio: 1 });

    // The scrolling items end where Sign out begins: no overlap, at any scroll position.
    const overlap = async () => {
      const [list, out] = await Promise.all([items.boundingBox(), signOut.boundingBox()]);
      expect(list && out && list.y + list.height <= out.y + 0.5).toBe(true);
    };
    await overlap();

    // The last item can be scrolled fully into view above Sign out and is not covered by it.
    await guide.scrollIntoViewIfNeeded();
    await overlap();
    const link = await guide.boundingBox();
    const out = await signOut.boundingBox();
    expect(link && out && link.y + link.height <= out.y).toBe(true);
    const covered = await guide.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return !(top && el.contains(top));
    });
    expect(covered).toBe(false);
    await expect(guide).toBeInViewport({ ratio: 1 });

    // And the first item is still reachable.
    await menu.getByRole('menuitem').first().scrollIntoViewIfNeeded();
    await expect(menu.getByRole('menuitem').first()).toBeInViewport({ ratio: 1 });
  });
}
