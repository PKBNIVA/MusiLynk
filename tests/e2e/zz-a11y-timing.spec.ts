import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSettledPage } from './qa-helpers';

// Scratch: where does the time go in one accessibility sweep test? Not committed.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const path of ['/about', '/pricing', '/']) {
  test(`timing ${path}`, async ({ page }) => {
    const t0 = Date.now();
    const marks: string[] = [];
    const mark = (label: string) => marks.push(`${label}=${Date.now() - t0}ms`);
    await openSettledPage(page, path);
    mark('openSettledPage');
    await page.waitForLoadState('networkidle');
    mark('networkidle');
    await new AxeBuilder({ page }).withTags(TAGS).analyze();
    mark('axe');
    await new AxeBuilder({ page }).withTags(TAGS).disableRules(['color-contrast']).analyze();
    mark('axe-no-contrast');
    console.log(`TIMING ${path} ${marks.join(' ')}`);
  });
}

test('axe really reports an injected violation', async ({ page }) => {
  await openSettledPage(page, '/about');
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text';
    document.querySelector('main')!.append(input);
  });
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(violations.map((v) => v.id)).toContain('label');
});
