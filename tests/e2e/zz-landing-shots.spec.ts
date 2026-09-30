import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { mockSignupApi, SOUNDCLOUD, YOUTUBE } from './support/signup-fixtures';

// Design screenshots of the landing page and the two-minute sign-up (mocked API). On demand only.
// Screenshots land in $SHOTS_DIR (default: .qa-stack/shots in the repo, which is git-ignored).
// The default is resolved from this file, so it is the repo's .qa-stack/shots from any working directory.
const OUT = join(process.env.SHOTS_DIR || fileURLToPath(new URL('../../.qa-stack/shots', import.meta.url)), 'landing');
test.skip(!process.env.LANDING_SHOTS, 'Screenshots on demand only.');

const PASSWORD = 'Harbor-Lantern-4827!';
const shot = async (page: Page, name: string, fullPage = false) => {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 72, fullPage });
};

for (const [label, size] of [
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }],
  ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
] as const) {
  test.describe(label, () => {
    test.use(size);

    test('landing', async ({ page }) => {
      await mockSignupApi(page, { stats: {} });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `01-landing-hero-${label}`);
      await page.locator('#how-it-works').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('how-it-works')?.scrollIntoView({ block: 'start' }));
      await shot(page, `02-how-it-works-${label}`);
      await shot(page, `03-landing-full-${label}`, true);
    });

    test('musician sign-up', async ({ page }) => {
      await mockSignupApi(page);
      await page.goto('/join/musician');
      await page.getByRole('button', { name: 'Drummer', exact: true }).click();
      await page.getByRole('button', { name: 'Percussionist' }).click();
      await shot(page, `04-musician-step1-${label}`);
      await page.getByRole('button', { name: 'Next: your work' }).click();
      const link = page.getByLabel('Paste links to your work');
      await link.fill(YOUTUBE);
      await link.press('Enter');
      await link.fill(SOUNDCLOUD);
      await link.press('Enter');
      await expect(page.getByTestId('work-link')).toHaveCount(2);
      await page.getByLabel(/Years of experience/).fill('8');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `05-musician-step2-links-${label}`);
      await page.getByRole('button', { name: 'Next: your account' }).click();
      await page.getByLabel('Your name').fill('Riya Desai');
      await page.getByLabel('Email').fill('riya@example.invalid');
      await page.getByRole('button', { name: 'Use a password instead' }).click();
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByLabel(/I agree to the Terms/).check();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `06-musician-step3-account-${label}`);
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page.getByTestId('welcome-next-step')).toContainText('2 work samples');
      await shot(page, `07-musician-first-dashboard-${label}`);
    });

    test('hirer sign-up', async ({ page }) => {
      await mockSignupApi(page);
      await page.goto('/join/hiring');
      await page.getByLabel('Event or wedding company').check();
      await page.getByLabel('Company name').fill('Shaadi Beats Events');
      await shot(page, `08-hirer-step1-${label}`);
      await page.getByRole('button', { name: 'Next: your account' }).click();
      await page.getByLabel('Your name').fill('Anita Kulkarni');
      await page.getByLabel('Email').fill('anita@example.invalid');
      await page.getByLabel(/I agree to the Terms/).check();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `09-hirer-step2-account-${label}`);
      await page.getByRole('button', { name: 'Use a password instead' }).click();
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page.getByTestId('welcome-next-step')).toBeVisible();
      await shot(page, `10-hirer-first-dashboard-${label}`);
    });
  });
}
