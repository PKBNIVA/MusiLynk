import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInWithDialogFixtures } from './support/dialog-fixtures';

// Cross-cutting accessibility of shared widgets: account menu, workspace-tools menu, and the page behind an open modal.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const RULES = [
  'aria-required-children',
  'aria-required-parent',
  'aria-hidden-focus',
  'listitem',
  'list',
  'label',
  'scrollable-region-focusable',
  'color-contrast',
];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withRules(RULES).analyze();
  return result.violations.map(
    (v) =>
      `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' :: ' + (n.any[0]?.message ?? '') + ' :: ' + n.html.slice(0, 160)).join(' | ')}`,
  );
}

for (const role of ['jobseeker', 'employer'] as const) {
  test(`${role}: open account menu has no menu-structure or hidden-focus violations`, async ({ page }) => {
    await signInWithDialogFixtures(page, role);
    await page.goto(`/${role}`);
    await page.getByRole('button', { name: /Open account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test(`${role}: workspace tools menu on a phone has no violations`, async ({ page }) => {
    await signInWithDialogFixtures(page, role);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${role}`);
    await page.getByRole('button', { name: 'Open all workspace tools' }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}

test('an open select list is scrollable by keyboard and hides nothing focusable', async ({ page }) => {
  await signInWithDialogFixtures(page, 'jobseeker');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/jobseeker/library');
  await page.getByRole('combobox').first().click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

for (const role of ['jobseeker', 'employer'] as const) {
  for (const width of [360, 390]) {
    test(`${role}: signed-in top bar fits ${width}px with a long name`, async ({ page }) => {
      await signInWithDialogFixtures(page, role);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${role}`);
      const nav = page.getByRole('navigation', { name: 'Workspace navigation' });
      await expect(nav).toBeVisible();
      const m = await page.evaluate(() => {
        const row = document.querySelector('nav[aria-label="Workspace navigation"] > div') as HTMLElement;
        return {
          row: row.scrollWidth,
          row_client: row.clientWidth,
          doc: document.documentElement.scrollWidth,
          view: window.innerWidth,
        };
      });
      expect(m.row).toBeLessThanOrEqual(m.row_client);
      expect(m.doc).toBeLessThanOrEqual(m.view);
    });
  }
}
