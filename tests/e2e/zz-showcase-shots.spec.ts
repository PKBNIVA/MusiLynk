import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signInShowcase } from './support/showcase-fixtures';

// Screenshots land in $SHOTS_DIR (default: .qa-stack/shots in the repo, which is git-ignored).
const OUT = join(process.env.SHOTS_DIR ?? '.qa-stack/shots', 'showcase');
test.skip(!process.env.SHOWCASE_SHOTS, 'Screenshots on demand only.');

const shot = async (page: Page, name: string, fullPage = true) => {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 72, fullPage });
};

for (const [label, size] of [
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }],
  ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
] as const) {
  test.describe(label, () => {
    test.use(size);
    test('switcher', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/portfolios');
      await expect(page.getByTestId('portfolio-card').first()).toBeVisible();
      await page.getByTestId('identity-switcher').click();
      await expect(page.getByRole('menuitemradio', { name: /Riya Studios/ })).toBeVisible();
      await shot(page, `switcher-${label}`, false);
      await page.getByRole('menuitemradio', { name: /Riya Studios/ }).click();
      await expect(page.getByTestId('acting-as-chip')).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, `switcher-acting-as-${label}`, false);
    });
    test('library', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/library');
      await expect(page.getByTestId('library-item').first()).toBeVisible();
      await shot(page, `library-${label}`);
      await page.getByRole('button', { name: 'Add work' }).click();
      await page.getByLabel(/^Title/).fill('Late set at Blue Frog');
      await page.getByLabel(/^Link/).fill('https://media.verse.test/late.mp3');
      await page.getByRole('button', { name: /Next: what you did/ }).click();
      await page.getByRole('combobox', { name: 'Genres' }).fill('Jazz');
      await page.getByRole('combobox', { name: 'Genres' }).press('Enter');
      await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('live');
      await page.getByRole('textbox', { name: 'Tags', exact: true }).press('Enter');
      await shot(page, `library-add-step2-${label}`);
      await page.getByRole('button', { name: 'Add to my work' }).click();
      await expect(page.getByTestId('sync-result')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `library-added-suggestion-${label}`, false);
    });
    test('portfolio editor', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/portfolios/p1');
      await expect(page.getByTestId('portfolio-preview')).toBeVisible();
      await page
        .getByTestId('inherited-portfolio-headline')
        .getByRole('button', { name: /Override/ })
        .click();
      await page.getByTestId('inherited-portfolio-headline').getByRole('textbox').fill('Jazz keys for studio sessions');
      await page.getByRole('button', { name: 'Save headline' }).click();
      await page.getByRole('button', { name: 'Exclude Live at NH7 Weekender' }).click();
      await page.getByRole('button', { name: 'Edit rules' }).click();
      await shot(page, `portfolio-editor-${label}`);
    });
    test('draft by elimination', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/portfolios/new');
      await page.getByLabel(/What is it for/).fill('film scoring reel for OTT');
      await page.getByRole('button', { name: 'Pick my matching work' }).click();
      await expect(page.getByTestId('draft-item').first()).toBeVisible();
      await page.getByRole('checkbox', { name: /Untitled demo/ }).uncheck();
      await shot(page, `draft-elimination-${label}`);
    });
    test('inbox', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/review');
      await expect(page.getByTestId('suggestion').first()).toBeVisible();
      await shot(page, `review-inbox-${label}`);
    });
    test('apply picker', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/jobs/job-1');
      await expect(page.getByTestId('apply-materials').getByTestId('portfolio-preview')).toBeVisible();
      await shot(page, `apply-picker-${label}`);
    });
    test('public portfolio', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/p/jazz-sessions-x7k2qa');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `public-portfolio-${label}`);
    });
    test('resume print and career', async ({ page }) => {
      await signInShowcase(page);
      await page.goto('/jobseeker/resumes/r1/print');
      await expect(page.getByTestId('resume-print').getByRole('heading', { level: 1 })).toBeVisible();
      await shot(page, `resume-print-${label}`);
      await page.goto('/jobseeker/career');
      await expect(page.getByTestId('career-entry').first()).toBeVisible();
      await shot(page, `career-record-${label}`);
    });
  });
}
