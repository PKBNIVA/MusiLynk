import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';
import {accessibilityRoutes, openSettledPage} from './qa-helpers';
import {CONVERSATION_ID, REPORT_JOB_ID, signInWithDialogFixtures} from './support/dialog-fixtures';

test.describe('WCAG accessibility and colour contrast', () => {
  for (const [name, path] of accessibilityRoutes) {
    test(`${name} has no automatically detectable WCAG A/AA violations`, async ({page}, testInfo) => {
      await openSettledPage(page, path);
      const result = await new AxeBuilder({page})
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
        result.violations.map(v => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length})`).join('\n'),
      ).toEqual([]);
    });
  }
});

test.describe('WCAG accessibility of in-app dialogs and signed-in forms', () => {
  test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

  const scenarios = [
    {name: 'Conversation report dialog', path: `/jobseeker/messages?c=${CONVERSATION_ID}`, open: 'report-conversation', dialog: 'Report Pushy Person'},
    {name: 'Listing report dialog', path: `/jobseeker/jobs/${REPORT_JOB_ID}`, open: 'Report listing', dialog: 'Report this listing'},
    {name: 'Verification request dialog', path: '/jobseeker/profile', open: 'Request verification', dialog: 'Request professional verification'},
  ];
  for (const scenario of scenarios) {
    test(`${scenario.name} has no automatically detectable WCAG A/AA violations`, async ({page}, testInfo) => {
      await page.setViewportSize({width: 1280, height: 900});
      await signInWithDialogFixtures(page);
      await page.goto(scenario.path);
      const trigger = scenario.open.includes('-') ? page.getByTestId(scenario.open) : page.getByRole('button', {name: scenario.open});
      await trigger.click();
      const dialog = page.getByRole('dialog', {name: scenario.dialog});
      await expect(dialog).toBeVisible();
      // Include the error state, which adds role=alert and aria-invalid content.
      await dialog.getByRole('button', {name: /Send report|Submit for review/}).click();
      await expect(dialog.getByText(/Choose a reason|Add a link/)).toBeVisible();
      const result = await new AxeBuilder({page})
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      if (result.violations.length) {
        await testInfo.attach('axe-violations.json', {body: JSON.stringify(result.violations, null, 2), contentType: 'application/json'});
      }
      expect(result.violations, result.violations.map(v => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length})`).join('\n')).toEqual([]);
    });
  }

  for (const [name, path, ready] of [
    ['Profile setup form', '/jobseeker/profile', 'Professional headline'],
    ['Job search', '/jobseeker/jobs', 'Search opportunities'],
  ] as const) {
    test(`${name} controls all have accessible labels`, async ({page}) => {
      await signInWithDialogFixtures(page);
      await page.goto(path);
      await expect(page.getByLabel(ready, {exact: true})).toBeVisible();
      const result = await new AxeBuilder({page}).withRules(['label', 'select-name', 'button-name', 'nested-interactive']).analyze();
      expect(result.violations, result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`).join('\n')).toEqual([]);
    });
  }
});
