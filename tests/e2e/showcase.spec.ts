import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInShowcase } from './support/showcase-fixtures';

// One account, many hats; one library, many views (see backend/docs/api-pages-portfolios-resumes.md).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

/** No serious or critical WCAG A/AA violations on the current page. */
async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious,
    serious
      .map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
      .join('\n'),
  ).toEqual([]);
}

test('identity switcher: act as a Page, send the header, show the chip, switch back', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/portfolios');
  await expect(page.getByRole('heading', { name: 'Portfolios', level: 1 })).toBeVisible();
  const switcher = page.getByTestId('identity-switcher');
  await expect(switcher).toHaveAccessibleName(/Acting as Riya Keys/);
  await switcher.click();
  await expect(page.getByRole('menuitemradio', { name: /Riya Keys/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: /Riya Studios/ }).click();
  await expect(page.getByText('Now acting as Riya Studios')).toBeVisible();
  await expect(page.getByTestId('acting-as-chip')).toContainText('Acting as Riya Studios');
  // The list reloads as the Page.
  await expect.poll(() => calls.some((c) => c.path === '/portfolios' && c.actAs === 'organization:org1')).toBe(true);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Switch back' }).click();
  await expect(page.getByTestId('acting-as-chip')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('verse_act_as'))).toBeNull();
});

test('switcher is hidden for someone with no Pages', async ({ page }) => {
  await signInShowcase(page, (_r, path) =>
    path === '/me/identities'
      ? { body: { identities: [{ type: 'user', id: 'qa-jobseeker', name: 'Riya', key: 'user:qa-jobseeker' }] } }
      : undefined,
  );
  await page.goto('/jobseeker/portfolios');
  await expect(page.getByRole('heading', { name: 'Portfolios', level: 1 })).toBeVisible();
  await expect(page.getByTestId('identity-switcher')).toHaveCount(0);
});

test('library: add work in two short steps and see where it landed', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/library');
  await expect(page.getByTestId('library-item')).toHaveCount(4);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Add work' }).click();
  await page.getByRole('button', { name: /Next: what you did/ }).click();
  await expect(page.getByLabel(/^Title/)).toBeFocused();
  await expect(page.locator('#work-title-error')).toHaveText('Give this work a title.');
  await page.getByLabel(/^Title/).fill('Late set at Blue Frog');
  await page.getByLabel(/^Link/).fill('https://media.musilynk.test/late.mp3');
  await page.getByRole('button', { name: /Next: what you did/ }).click();
  const genres = page.getByRole('combobox', { name: 'Genres' });
  await genres.fill('Jaz');
  await page.getByRole('option', { name: 'Jazz', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tags', exact: true }).fill('live');
  await page.getByRole('textbox', { name: 'Tags', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add to my work' }).click();
  await expect(page.getByTestId('sync-result')).toContainText('Added to 2 portfolios · 1 suggestion to review');
  const post = calls.find((c) => c.method === 'POST' && c.path === '/portfolio');
  expect(post?.body).toMatchObject({ title: 'Late set at Blue Frog', genres: ['Jazz'], tags: ['live'] });
  await page.getByTestId('sync-result').getByRole('link', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/jobseeker\/review$/);
});

test('library: filters narrow the list and deleting asks first', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/library');
  await page.getByRole('button', { name: 'Composer' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Composer' }).click();
  await page.getByPlaceholder('Search titles and tags').fill('nothing-matches');
  await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Delete Untitled demo' }).click();
  await page.getByRole('button', { name: 'Delete work' }).click();
  await expect(page.getByTestId('library-item')).toHaveCount(3);
  expect(calls.some((c) => c.method === 'DELETE' && c.path === '/portfolio/demo')).toBe(true);
});

test('portfolio editor: inherit, override, reset; pin and exclude; live preview', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/portfolios/p1');
  await expect(page.getByTestId('rules-sentence')).toHaveText(
    "Includes work where you're Keyboardist, or in Jazz or Blues.",
  );
  const headline = page.getByTestId('inherited-portfolio-headline');
  await expect(headline).toContainText('Inherited from your profile');
  await expectAccessible(page);

  await headline.getByRole('button', { name: /Override/ }).click();
  await headline.getByRole('textbox').fill('Jazz keys for studio sessions');
  await headline.getByRole('button', { name: 'Save headline' }).click();
  await expect(headline).toContainText('Your own version');
  await expect(page.getByTestId('portfolio-preview')).toContainText('Jazz keys for studio sessions');
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ headline: 'Jazz keys for studio sessions' });

  await headline.getByRole('button', { name: /Reset to profile/ }).click();
  await expect(headline).toContainText('Inherited from your profile');
  expect(calls.find((c) => c.path === '/portfolios/p1/reset')?.body).toEqual({ fields: ['headline'] });

  const preview = page.getByTestId('portfolio-preview');
  await expect(preview).toContainText('2 pieces of work');
  await page.getByRole('button', { name: 'Exclude Live at NH7 Weekender' }).click();
  await expect(preview).toContainText('1 piece of work');
  await page.getByRole('radio', { name: 'Left out' }).click();
  await expect(page.getByTestId('portfolio-row').filter({ hasText: 'Live at NH7' })).toContainText('Excluded');
  await page.getByRole('button', { name: /Back to automatic.*Live at NH7 Weekender/ }).click();
  await page.getByRole('button', { name: 'Pin Monsoon — OTT film cue' }).click();
  await expect(preview).toContainText('3 pieces of work');
  expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
    { state: 'excluded' },
    { state: 'auto' },
    { state: 'pinned' },
  ]);

  // Editing the rules previews them live before saving.
  await page.getByRole('button', { name: 'Edit rules' }).click();
  await page.getByRole('radio', { name: /All my work/ }).check();
  await expect(page.getByTestId('rules-sentence')).toContainText('Includes all your work');
  await expect(page.getByText('The preview shows your unsaved rules.')).toBeVisible();
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'PATCH' && (c.body as { rules?: unknown }).rules)?.body)
    .toMatchObject({
      rules: { everything: true, only: { genres: ['Jazz', 'Blues'], roles: ['Keyboardist'] } },
    });
  await expect(page.getByTestId('public-link')).toContainText('/p/jazz-sessions-x7k2qa');
});

test('new portfolio by elimination: describe a goal, untick misfits, create', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/portfolios/new');
  await expect(page.getByRole('radio', { name: /Start from a goal/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel(/What is it for/).fill('film scoring reel for OTT');
  await page.getByRole('button', { name: 'Pick my matching work' }).click();
  await expect(page.getByTestId('draft-summary')).toHaveText('Keeping 2 of 4. Untick anything that doesn’t belong.');
  await expect(page.getByLabel(/^Name/)).toHaveValue('Film scoring reel');
  await expect(page.getByText('Removed: genres Jazz, not Film score')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('checkbox', { name: /Untitled demo/ }).uncheck();
  await page.getByRole('checkbox', { name: /Blue in green/ }).check();
  await page.getByRole('button', { name: 'Create portfolio with 2 pieces' }).click();
  await expect(page).toHaveURL(/\/jobseeker\/portfolios\/p3$/);
  expect(calls.find((c) => c.method === 'POST' && c.path === '/portfolios')?.body).toMatchObject({
    title: 'Film scoring reel',
    rules: { everything: true, only: { genres: ['Film score'] } },
    pinnedItemIds: ['blue'],
    excludedItemIds: ['demo'],
  });
});

test('resume print view is laid out for paper', async ({ page }) => {
  await signInShowcase(page);
  await page.goto('/jobseeker/resumes/r1/print');
  const sheet = page.getByTestId('resume-print');
  await expect(sheet.getByRole('heading', { name: 'Riya Keys', level: 1 })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Experience' })).toBeVisible();
  await expect(sheet).toContainText('The Local Train · India tour · 2021–now');
  await expectAccessible(page);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: /Print or save as PDF/ })).toBeHidden();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('resume editor: rules, entries and section order', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/resumes/r1');
  await expect(page.getByTestId('rules-sentence')).toHaveText('Includes all your career record.');
  await expect(page.getByTestId('resume-entry')).toHaveCount(5);
  await page.getByRole('button', { name: 'Move Credits up' }).click();
  await expect
    .poll(() =>
      (calls.find((c) => c.method === 'PATCH')?.body as { sectionOrder?: string[] } | undefined)?.sectionOrder?.slice(
        0,
        2,
      ),
    )
    .toEqual(['credit', 'experience']);
  await expectAccessible(page);
});

test('review inbox: reasons, accept, reject, accept all, and the header badge', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/review');
  const items = page.getByTestId('suggestion');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Add “Live at NH7 Weekender” to “Live performer”?');
  await expect(items.first()).toContainText('Why: Its title or description mentions jazz');
  await expect(page.getByTestId('review-badge')).toHaveText('2');
  await expectAccessible(page);
  await items
    .nth(1)
    .getByRole('button', { name: /^Reject/ })
    .click();
  await expect(items).toHaveCount(1);
  await expect(page.getByTestId('review-badge')).toHaveText('1');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('· Rejected')).toBeVisible();
  await page.getByRole('tab', { name: 'To review' }).click();
  await items
    .first()
    .getByRole('button', { name: /^Accept/ })
    .click();
  await expect(page.getByText('You’re all caught up')).toBeVisible();
  await expect(page.getByTestId('review-badge')).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/suggestions/s2/reject',
    '/suggestions/s1/accept',
  ]);
});

test('review inbox: accept all', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/review');
  await page.getByRole('button', { name: 'Accept all (2)' }).click();
  await expect(page.getByText('Accepted 2 suggestions')).toBeVisible();
  expect(calls.some((c) => c.path === '/suggestions/accept-all')).toBe(true);
});

test('apply: defaults are picked, the employer preview shows, and the ids are sent', async ({ page }) => {
  const { calls } = await signInShowcase(page);
  await page.goto('/jobseeker/jobs/job-1');
  await expect(page.getByTestId('posted-by')).toContainText('Posted by Riya Studios');
  const materials = page.getByTestId('apply-materials');
  await expect(materials.getByLabel('Portfolio')).toContainText('Jazz sessions');
  await expect(materials.getByLabel('Resume')).toContainText('Session CV');
  await expect(materials.getByTestId('portfolio-preview')).toContainText('Blue in green (trio take)');
  await expect(page.getByTestId('frozen-note')).toContainText('frozen copy');
  await expectAccessible(page);
  await materials.getByLabel('Portfolio').click();
  await page.getByRole('option', { name: /Live performer/ }).click();
  await expect(materials.getByTestId('portfolio-preview')).toContainText('Live at NH7');
  await page.getByRole('button', { name: 'Apply now' }).click();
  await expect(page.getByText('Application submitted').first()).toBeVisible();
  expect(calls.find((c) => c.path === '/jobs/job-1/apply')?.body).toMatchObject({ portfolioId: 'p2', resumeId: 'r1' });
});

test('public portfolio page is an EPK with meta, rates, work and a contact link', async ({ page }) => {
  await signInShowcase(page);
  await page.goto('/p/jazz-sessions-x7k2qa');
  await expect(page.getByRole('heading', { name: 'Riya Keys', level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Riya Keys — Keys player and composer/);
  await expect(page.getByText('₹6,000–9,000 per session')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blue in green (trio take)' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact Riya' })).toHaveAttribute('href', '/professionals/qa-jobseeker');
  await expectAccessible(page);
  await page.goto('/p/nope');
  await expect(page.getByRole('heading', { name: 'This portfolio isn’t available' })).toBeVisible();
});

test('a Page lists the jobs it posted', async ({ page }) => {
  await signInShowcase(page);
  await page.goto('/pages/organization/org1');
  await expect(page.getByRole('heading', { name: 'Riya Studios', level: 1 })).toBeVisible();
  await expect(page.getByTestId('job-card')).toContainText('Posted by Riya Studios');
  await expectAccessible(page);
});

test('career record: add an entry with inline validation', async ({ page }) => {
  const { calls } = await signInShowcase(page, (request, path) =>
    path === '/career-entries' && request.method() === 'POST'
      ? {
          status: 201,
          body: { id: 'c9', entry: { id: 'c9', kind: 'award', fields: { title: 'Best score' }, tags: [] } },
        }
      : undefined,
  );
  await page.goto('/jobseeker/career');
  await expect(page.getByTestId('career-entry')).toHaveCount(5);
  await page.getByRole('button', { name: 'Add to awards' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#career-award-title-error')).toHaveText('Add the award.');
  await page.getByRole('textbox', { name: /^Award/ }).fill('Best score');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('career-entry')).toHaveCount(6);
  expect(calls.find((c) => c.method === 'POST' && c.path === '/career-entries')?.body).toMatchObject({
    kind: 'award',
    fields: { title: 'Best score' },
  });
  await expectAccessible(page);
});
