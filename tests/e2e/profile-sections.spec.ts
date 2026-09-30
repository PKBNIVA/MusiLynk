import { expect, test, type Page, type Route } from '@playwright/test';

// The profile page is one page of anchored sections that save themselves (J-18): a "Saved" state
// per section, a guard against losing unsaved edits, addresses completed to https://, and a
// visible pending state after asking for verification.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const musician = {
  id: 'qa-musician',
  name: 'QA Musician',
  email: 'musician@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
  emailVerified: true,
  verified: false,
  headline: 'Session guitarist',
  location: 'Mumbai',
  experience: '5 years',
  bio: 'Session guitarist in Mumbai.',
  availability: '',
  currency: 'INR',
  dayRate: null,
  sessionRate: null,
  showRate: null,
  hourlyRate: null,
  tourDayRate: null,
  skills: ['Guitar'],
  genres: [],
  instruments: [],
  languages: [],
  credits: [],
  openTo: [],
  roles: [],
  gear: [],
  software: [],
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page: Page, options: { putDelayMs?: number } = {}) {
  const puts: Record<string, unknown>[] = [];
  const posts: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { user: musician });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/profile' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      puts.push(body);
      if (options.putDelayMs) await new Promise((resolve) => setTimeout(resolve, options.putDelayMs));
      return json(route, { user: { ...musician, ...body } });
    }
    if (request.method() === 'POST') posts.push({ path, body: request.postDataJSON() });
    return json(route, {});
  });
  return { puts, posts };
}

test('a section saves itself after a pause, on its own, and says so', async ({ page }) => {
  const { puts } = await mock(page);
  await page.goto('/jobseeker/profile');
  await expect(page.getByLabel('Professional headline')).toHaveValue('Session guitarist');
  await expect(page.getByTestId('section-status-about')).toHaveText('');

  await page.getByLabel('Professional headline').fill('Session guitarist, Hindi and English rock');
  await expect(page.getByTestId('section-status-about')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('section-status-about')).toHaveText('Saved', { timeout: 5_000 });
  expect(puts).toHaveLength(1);
  // Only the About section's fields were sent; the other sections were left alone.
  expect(Object.keys(puts[0]).sort()).toEqual(['bio', 'experience', 'headline', 'location']);
  expect(puts[0].headline).toBe('Session guitarist, Hindi and English rock');
  await expect(page.getByTestId('section-status-skills')).toHaveText('');

  // Leaving a section saves it straight away, without waiting for the pause.
  await page.getByLabel('Availability', { exact: true }).fill('Weekends');
  await page.getByLabel('Website').focus();
  await expect(page.getByTestId('section-status-rates')).toHaveText('Saved');
  expect(Object.keys(puts[1]).sort()).toEqual([
    'availability',
    'currency',
    'dayRate',
    'hourlyRate',
    'sessionRate',
    'showRate',
    'tourDayRate',
  ]);
});

test('a web address typed as example.com is completed to https:// before it is checked or sent', async ({ page }) => {
  const { puts } = await mock(page);
  await page.goto('/jobseeker/profile');
  const website = page.getByLabel('Website');
  await website.fill('example.com/showreel');
  await website.blur();
  await expect(website).toHaveValue('https://example.com/showreel');
  await expect(page.getByTestId('section-status-links')).toHaveText('Saved');
  expect(puts.at(-1)?.website).toBe('https://example.com/showreel');
  await expect(page.locator('#profile-website-error')).toHaveCount(0);

  await website.fill('not a url');
  await page.getByLabel('Phone').focus();
  await page.getByLabel('Bio').focus();
  await expect(page.locator('#profile-website-error')).toHaveText('Enter a full web address starting with https://');
  await expect(page.getByTestId('section-status-links')).toHaveText(/Not saved/);
});

test('leaving with unsaved changes asks first', async ({ page }) => {
  // A web address that cannot be saved stays unsaved while the person tries to leave.
  await mock(page);
  await page.goto('/jobseeker/profile');
  await page.getByLabel('Website').fill('not a url');
  await page.getByLabel('Phone').focus();
  await page.getByLabel('Bio').focus(); // leaving Links tries to save it and cannot
  await expect(page.getByTestId('section-status-links')).toHaveText(/Not saved/);
  const home = page.getByRole('link', { name: 'Verse dashboard' });
  await home.click();
  const dialog = page.getByTestId('unsaved-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/jobseeker\/profile/);
  await expect(page.getByLabel('Website')).toHaveValue('not a url');

  await home.click();
  await page.getByTestId('unsaved-dialog').getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page).not.toHaveURL(/\/jobseeker\/profile/);
});

test('leaving while a save is on its way waits for it instead of asking', async ({ page }) => {
  await mock(page, { putDelayMs: 1_500 });
  await page.goto('/jobseeker/profile');
  await page.getByLabel('Professional headline').fill('Session guitarist and arranger');
  await page.getByLabel('Website').focus(); // leaving About starts its (slow) save
  await page.getByRole('link', { name: 'Verse dashboard' }).click();
  await expect(page.getByTestId('unsaved-dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/jobseeker\/profile/);
});

test('asking for verification leaves a Pending review state, also after a reload', async ({ page }) => {
  const { posts } = await mock(page);
  await page.goto('/jobseeker/profile');
  await page.getByRole('button', { name: 'Request verification' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request professional verification' });
  await dialog.getByLabel('Proof URL').fill('https://label.example/credits/asha');
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('verification-pending')).toHaveText(/Pending review/);
  await expect(page.getByRole('button', { name: 'Request verification' })).toHaveCount(0);
  expect(posts.find((p) => p.path === '/verification-requests')?.body).toMatchObject({ kind: 'professional' });

  await page.reload();
  await expect(page.getByTestId('verification-pending')).toBeVisible();
});

test('the section links jump to their section and the page is one column of sections on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto('/jobseeker/profile');
  const nav = page.getByRole('navigation', { name: 'Profile sections' });
  for (const name of ['About', 'Skills & genres', 'Rates & availability', 'Links', 'Verification'])
    await expect(nav.getByRole('link', { name })).toBeVisible();
  await nav.getByRole('link', { name: 'Links' }).click();
  await expect(page.getByRole('heading', { name: 'Links', level: 2 })).toBeFocused();
  await expect(page.getByLabel('Website')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
