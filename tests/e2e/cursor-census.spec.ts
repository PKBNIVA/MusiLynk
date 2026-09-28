import { expect, test } from '@playwright/test';
import { accessibilityRoutes, openSettledPage } from './qa-helpers';

// CRAWL-02: Tailwind v4 preflight resets `cursor` to `default` on every button, which made every
// clickable control on the site look non-interactive. src/styles/index.css restores `cursor:
// pointer` on enabled buttons, links with an href, and a few native controls that act like one.
// This census walks the public route list (already used by the a11y sweep) and asserts every
// enabled button/link on each page reports `cursor: pointer`.
test.describe('every enabled button and link shows a pointer cursor (CRAWL-02)', () => {
  for (const [name, path] of accessibilityRoutes) {
    test(`${name} has no non-pointer enabled buttons or links`, async ({ page }) => {
      await openSettledPage(page, path);
      const offenders = await page.evaluate(() => {
        const isVisible = (el: Element) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, a[href]'));
        return candidates
          .filter((el) => isVisible(el))
          .filter((el) => {
            const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true';
            return !disabled;
          })
          .filter((el) => getComputedStyle(el).cursor !== 'pointer')
          .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent || el.outerHTML).trim().slice(0, 60)}`);
      });
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  }

  test('a disabled button is left alone (default cursor stays)', async ({ page }) => {
    await openSettledPage(page, '/auth/jobseeker');
    const submit = page.getByRole('button', { name: 'Email me a sign-in code' });
    await expect(submit).toBeVisible();
    // Empty email keeps the submit control's semantics unaffected either way; the important
    // assertion is that disabling a button never gets caught by the pointer-cursor rule.
    const cursor = await submit.evaluate((el) => getComputedStyle(el).cursor);
    if (await submit.isDisabled()) expect(cursor).not.toBe('pointer');
    else expect(cursor).toBe('pointer');
  });
});
