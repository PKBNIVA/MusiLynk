import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CONVERSATION_ID, REPORT_JOB_ID, signInWithDialogFixtures } from './support/dialog-fixtures';

// The report and verification flows used window.prompt, which screen readers announce poorly,
// cannot be styled or validated, and is blocked in some embedded browsers. They are now in-app
// dialogs; these tests drive them by mouse and by keyboard alone.

test('no native prompt, confirm or alert calls remain in the frontend source', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(tsx?|jsx?)$/.test(name)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, index) => {
            const code = line.replace(/\/\/.*$/, '');
            if (/\bwindow\.(prompt|confirm|alert)\s*\(|(^|[^.\w])(prompt|confirm|alert)\s*\(/.test(code))
              offenders.push(`${file}:${index + 1}`);
          });
      }
    }
  };
  walk(join(process.cwd(), 'src'));
  expect(offenders).toEqual([]);
});

test.describe('in-app dialogs', () => {
  test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

  test('reporting a conversation partner works with the keyboard alone and returns focus', async ({ page }) => {
    const state = await signInWithDialogFixtures(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/jobseeker/messages?c=${CONVERSATION_ID}`);
    const trigger = page.getByTestId('report-conversation');
    await expect(trigger).toBeVisible();

    // Escape closes without sending, and focus goes back to the Report button.
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Report Pushy Person' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Harassment' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Submitting without a reason explains what is missing and sends nothing.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Reason' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: /community guidelines/ })).toHaveAttribute(
      'href',
      '/community-guidelines',
    );
    await dialog.getByRole('button', { name: 'Send report' }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText('Choose a reason for your report.');
    expect(state.reports).toEqual([]);

    // Pick a reason with the arrow keys, type details, submit with Enter.
    await dialog.getByRole('radio', { name: 'Harassment' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Asks for payment' })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('link', { name: /community guidelines/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Details (optional)')).toBeFocused();
    await page.keyboard.type('Asked for a registration fee by UPI.');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Send report' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText('Report sent to moderation.', { exact: false })).toBeVisible();
    expect(state.reports).toEqual([
      {
        entityType: 'user',
        entityId: 'u-2',
        reason: 'Asks for payment',
        details: `Asked for a registration fee by UPI.\n\nReported from conversation ${CONVERSATION_ID}.`,
      },
    ]);
    expect(state.nativeDialogs).toEqual([]);
    expect(state.pageErrors).toEqual([]);
  });

  test('reporting a job listing sends the reason and details to moderation', async ({ page }) => {
    const state = await signInWithDialogFixtures(page);
    await page.goto(`/jobseeker/jobs/${REPORT_JOB_ID}`);
    await page.getByRole('button', { name: 'Report listing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this listing' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    // "Other" needs a sentence of explanation.
    await dialog.getByRole('radio', { name: 'Other' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Tell us briefly what is wrong');
    await dialog.getByRole('radio', { name: 'Misleading listing' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Report listing' }).click();
    await page
      .getByRole('dialog', { name: 'Report this listing' })
      .getByRole('radio', { name: 'Spam or scam' })
      .check();
    await page
      .getByRole('dialog', { name: 'Report this listing' })
      .getByLabel('Details (optional)')
      .fill('Same post under five names.');
    await page
      .getByRole('dialog', { name: 'Report this listing' })
      .getByRole('button', { name: 'Send report' })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(state.reports).toEqual([
      { entityType: 'job', entityId: REPORT_JOB_ID, reason: 'Misleading listing' },
      { entityType: 'job', entityId: REPORT_JOB_ID, reason: 'Spam or scam', details: 'Same post under five names.' },
    ]);
    expect(state.nativeDialogs).toEqual([]);
  });

  test('a failed report keeps the dialog open with the error', async ({ page }) => {
    await signInWithDialogFixtures(page);
    await page.route('**/api/reports', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Too many reports. Try again later.' }),
      }),
    );
    await page.goto(`/jobseeker/jobs/${REPORT_JOB_ID}`);
    await page.getByRole('button', { name: 'Report listing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this listing' });
    await dialog.getByRole('radio', { name: 'Spam or scam' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Too many reports');
    await expect(dialog.getByRole('radio', { name: 'Spam or scam' })).toBeChecked();
  });

  test('a duplicate report on the same listing keeps the dialog open with a friendly message', async ({ page }) => {
    await signInWithDialogFixtures(page);
    await page.route('**/api/reports', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'You already have an open report on this. Our moderators will review it.',
          code: 'ALREADY_REPORTED',
        }),
      }),
    );
    await page.goto(`/jobseeker/jobs/${REPORT_JOB_ID}`);
    await page.getByRole('button', { name: 'Report listing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Report this listing' });
    await dialog.getByRole('radio', { name: 'Spam or scam' }).check();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'You already have an open report on this. Our moderators will review it.',
    );
    await expect(dialog).toBeVisible();
  });

  test('professional verification takes a validated proof URL, keyboard only', async ({ page }) => {
    const state = await signInWithDialogFixtures(page);
    await page.goto('/jobseeker/profile');
    const trigger = page.getByRole('button', { name: 'Request verification' });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Request professional verification' });
    const url = dialog.getByRole('textbox', { name: 'Proof URL' });
    await expect(url).toBeFocused();

    // Empty and non-http links are rejected with a message tied to the field.
    await page.keyboard.press('Enter');
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await expect(url).toHaveAccessibleDescription(/Add a link to your proof/);
    await page.keyboard.type('javascript:alert(1)');
    await page.keyboard.press('Enter');
    await expect(url).toHaveAccessibleDescription(/starting with https:\/\//);
    await expect(url).toBeFocused();
    expect(state.verificationRequests).toEqual([]);

    await url.fill('');
    await page.keyboard.type('https://label.example/credits/asha');
    await expect(url).not.toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(state.verificationRequests).toEqual([
      {
        kind: 'professional',
        evidenceUrl: 'https://label.example/credits/asha',
        note: 'Professional verification request',
      },
    ]);

    // Escape cancels without a request.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(state.verificationRequests).toHaveLength(1);
    expect(state.nativeDialogs).toEqual([]);
    expect(state.pageErrors).toEqual([]);
  });

  test('profile form fields are labelled', async ({ page }) => {
    await signInWithDialogFixtures(page);
    await page.goto('/jobseeker/profile');
    // The profile is a stepped form; each step's fields are labelled once that step is open.
    for (const [step, names] of [
      [null, ['Professional headline', 'Base location', 'Bio']],
      [/Music skills/, ['Skills']],
      [/Rates & links/, ['Website', 'Phone']],
    ] as const) {
      if (step) await page.getByRole('button', { name: step }).first().click();
      for (const name of names) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Currency')).toHaveAttribute('role', 'combobox');
    await expect(page.getByLabel('Professional headline', { exact: true })).toHaveValue('Session guitarist');
  });
});
