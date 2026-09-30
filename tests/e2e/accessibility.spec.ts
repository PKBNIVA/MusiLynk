import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { accessibilityRoutes, openSettledPage } from './qa-helpers';
import { CONVERSATION_ID, REPORT_JOB_ID, signInWithDialogFixtures } from './support/dialog-fixtures';

test.describe('WCAG accessibility and colour contrast', () => {
  for (const [name, path] of accessibilityRoutes) {
    test(`${name} has no automatically detectable WCAG A/AA violations`, async ({ page }, testInfo) => {
      await openSettledPage(page, path);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

      if (result.violations.length) {
        await testInfo.attach('axe-violations.json', {
          body: JSON.stringify(result.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(
        result.violations,
        result.violations.map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length})`).join('\n'),
      ).toEqual([]);
    });
  }
});

test.describe('WCAG accessibility of in-app dialogs and signed-in forms', () => {
  test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

  const scenarios = [
    {
      name: 'Conversation report dialog',
      path: `/jobseeker/messages?c=${CONVERSATION_ID}`,
      open: 'report-conversation',
      dialog: 'Report Pushy Person',
    },
    {
      name: 'Listing report dialog',
      path: `/jobseeker/jobs/${REPORT_JOB_ID}`,
      open: 'Report listing',
      dialog: 'Report this listing',
    },
    {
      name: 'Verification request dialog',
      path: '/jobseeker/profile',
      open: 'Request verification',
      dialog: 'Request professional verification',
    },
  ];
  for (const scenario of scenarios) {
    test(`${scenario.name} has no automatically detectable WCAG A/AA violations`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signInWithDialogFixtures(page);
      await page.goto(scenario.path);
      const trigger = scenario.open.includes('-')
        ? page.getByTestId(scenario.open)
        : page.getByRole('button', { name: scenario.open });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: scenario.dialog });
      await expect(dialog).toBeVisible();
      // Include the error state, which adds role=alert and aria-invalid content.
      await dialog.getByRole('button', { name: /Send report|Submit for review/ }).click();
      await expect(dialog.getByText(/Choose a reason|Add a link/)).toBeVisible();
      const result = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      if (result.violations.length) {
        await testInfo.attach('axe-violations.json', {
          body: JSON.stringify(result.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(
        result.violations,
        result.violations.map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length})`).join('\n'),
      ).toEqual([]);
    });
  }

  for (const [name, path, ready] of [
    ['Profile setup form', '/jobseeker/profile', 'Professional headline'],
    ['Job search', '/jobseeker/jobs', 'Search opportunities'],
  ] as const) {
    test(`${name} controls all have accessible labels`, async ({ page }) => {
      await signInWithDialogFixtures(page);
      await page.goto(path);
      await expect(page.getByLabel(ready, { exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withRules(['label', 'select-name', 'button-name', 'nested-interactive'])
        .analyze();
      expect(
        result.violations,
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n'),
      ).toEqual([]);
    });
  }
});

// Phase 3 fixes (P3-01, 05, 06, 09): a plain keyboard/mouse-interaction check for the pieces axe
// cannot judge by itself — a real focus outline appearing, hover feedback appearing, the skip
// link's target being reachable, and a toast surviving at least 4s.
test.describe('Phase 3 UX regressions', () => {
  test('a bespoke input not built on the shared Input primitive still gets a visible focus ring (P3-01)', async ({
    page,
  }) => {
    // The nav search box is desktop-only (`hidden lg:block`); pin the viewport so this assertion
    // doesn't depend on which device a project runs it under.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSettledPage(page, '/pricing');
    const search = page.locator('#public-search');
    await search.focus();
    await expect(search).toBeFocused();
    const outline = await search.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('a plain footer link with no hover styling of its own still shows hover feedback (P3-05)', async ({ page }) => {
    await openSettledPage(page, '/about');
    // The legal pages' related-page chips now carry their own hover classes, so add a bare link
    // to check the global fallback rule itself.
    await page.evaluate(() => {
      const bare = document.createElement('a');
      bare.href = '/terms';
      bare.textContent = 'Plain terms link';
      document.querySelector('main')!.append(bare);
    });
    const link = page.getByRole('link', { name: 'Plain terms link', exact: true });
    const before = await link.evaluate((el) => getComputedStyle(el).opacity);
    await link.hover();
    await expect.poll(() => link.evaluate((el) => getComputedStyle(el).opacity)).not.toBe(before);
  });

  test("the skip link's target exists and is reachable by keyboard (P3-09)", async ({ page }) => {
    await openSettledPage(page, '/');
    // sr-only until focused, so a real keyboard user reaches it by Tab, not a pointer click.
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toHaveAttribute('href', '#main');
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('a toast stays visible for at least 4s (P3-06)', async ({ page }) => {
    await openSettledPage(page, '/forgot-password');
    // Force a response that makes ForgotPassword raise a toast (the plain success path shows no
    // toast at all, and the catch-all API fixture above answers unmatched requests with `{}`).
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, debugLink: 'https://verse.local/reset/qa-fixture' }),
      }),
    );
    await page.getByLabel('Email').fill('qa+demo-ux1000-professional-0001@example.invalid');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(4000);
    await expect(toast).toBeVisible();
  });
});
