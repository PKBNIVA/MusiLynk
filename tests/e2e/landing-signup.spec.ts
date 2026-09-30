import { expect, test, type Page } from '@playwright/test';
import { mockSignupApi, SOUNDCLOUD, SPOTIFY, YOUTUBE } from './support/signup-fixtures';

// The landing page and the two-minute sign-up, against a mocked API.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const PASSWORD = 'Harbor-Lantern-4827!';

async function inViewport(page: Page, name: string | RegExp, role: 'link' | 'heading' = 'link') {
  const box = await page.getByRole(role, { name }).first().boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, `${name} is on the page`).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name} is above the fold`).toBeLessThanOrEqual(viewport.height);
}

test.describe('landing page', () => {
  test('on a 390×844 phone the promise and both paths show without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSignupApi(page);
    await page.goto('/');
    await inViewport(page, /Hire a verified musician for your session or gig/, 'heading');
    await inViewport(page, /I'm hiring/);
    await inViewport(page, /I'm a musician or crew/);
    const trigger = await page.getByRole('combobox', { name: /Now booking in/ }).boundingBox();
    expect(trigger!.height, 'city picker is a 44px touch target').toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('the two paths open the right sign-up', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/');
    await expect(page).toHaveTitle(/Mumbai/);
    // The shared dark listbox (AppSelect), not the OS <select> list.
    const city = page.getByRole('combobox', { name: /Now booking in/ });
    await expect(city).toHaveText('Mumbai');
    expect(await page.locator('select#landing-city').count()).toBe(0);
    await city.click();
    await expect(page.getByRole('option', { name: 'Mumbai' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('option', { name: 'Delhi, Bengaluru, Pune, Goa coming' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page
      .getByTestId('hero-paths')
      .getByRole('link', { name: /I'm hiring/ })
      .click();
    await expect(page).toHaveURL(/\/join\/hiring$/);
    await expect(page.getByRole('heading', { name: 'Join to hire musicians and crew' })).toBeVisible();
    await page.goBack();
    await page
      .getByTestId('hero-paths')
      .getByRole('link', { name: /I'm a musician or crew/ })
      .click();
    await expect(page).toHaveURL(/\/join\/musician$/);
  });

  test('"need someone by tomorrow" opens the public urgent form first', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/');
    await page.getByRole('link', { name: /Need someone by tomorrow/ }).click();
    // The public urgent form comes first; sign-in or the two-minute sign-up only gates sending it.
    await expect(page).toHaveURL(/\/urgent$/);
    await expect(page.getByRole('heading', { name: /Find a verified musician/ })).toBeVisible();
  });

  test('how it works switches between hirers and musicians', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/');
    const section = page.locator('#how-it-works');
    await expect(section.getByRole('heading', { name: 'Hear verified players' })).toBeVisible();
    await section.getByRole('tab', { name: "I'm a musician or crew" }).click();
    await expect(section.getByRole('heading', { name: 'Paste links to your work' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'Hear verified players' })).toBeHidden();
  });

  test('the promise strip is always there; real counts join it only once they are meaningful', async ({ page }) => {
    await mockSignupApi(page, {
      stats: { verifiedProfiles: 142, cities: 1, openOpportunities: 30, urgentRequests: 4 },
    });
    await page.goto('/');
    const proof = page.getByTestId('live-proof');
    await expect(proof.getByTestId('promise-strip')).toContainText('Verified by the Verse team');
    await expect(proof.getByRole('heading', { name: 'On Verse right now' })).toBeVisible();
    await expect(proof).toContainText('142');
    await expect(proof).toContainText('verified musicians and crew');
    await expect(proof).toContainText('34');
    await expect(proof).not.toContainText('cities');
  });

  test('with nothing meaningful to count, only the promises show and no number is invented', async ({ page }) => {
    await mockSignupApi(page, { stats: { verifiedProfiles: 3, cities: 1, openOpportunities: 0 } });
    await page.goto('/');
    const proof = page.getByTestId('live-proof');
    const strip = proof.getByTestId('promise-strip');
    await expect(strip.getByRole('listitem')).toHaveText([
      'Verified by the Verse team',
      'Reply within 2 hours, 9 am–11 pm IST',
      'Free to post · musicians never pay',
    ]);
    await expect(proof.getByRole('heading', { name: 'On Verse right now' })).toHaveCount(0);
    await expect(proof).not.toContainText(/\b3\b/);
  });

  test('the urgent band carries its role and time into the urgent form', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/');
    const band = page.getByTestId('urgent-band');
    await band.getByLabel('Role needed').fill('Tabla player');
    await band.getByLabel('Date & time').fill('2026-12-01T19:30');
    await band.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/urgent\?role=Tabla\+player&city=Mumbai&startAt=2026-12-01T19%3A30$/);
    await expect(page.locator('#urgent-start')).toHaveValue('2026-12-01T19:30');
  });

  test('role tiles link the 12 roles into the hire pages, and structured data describes the site', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Hire a drummer in Mumbai' })).toHaveAttribute(
      'href',
      '/hire/drummer/mumbai',
    );
    await expect(page.getByRole('link', { name: 'Hire a DJ in Mumbai' })).toBeVisible();
    await expect(page.getByTestId('role-tiles').getByRole('link')).toHaveCount(12);
    const data = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '[]');
    expect(data.map((entry: { '@type': string }) => entry['@type'])).toEqual(['Organization', 'WebSite']);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toMatch(/Mumbai/);
  });

  test('old "?mode=register" links land on the two-minute sign-up', async ({ page }) => {
    await mockSignupApi(page);
    await page.goto('/auth/jobseeker?mode=register');
    await expect(page).toHaveURL(/\/join\/musician$/);
    await page.goto('/auth/employer?mode=register');
    await expect(page).toHaveURL(/\/join\/hiring$/);
  });
});

test.describe('musician sign-up', () => {
  test('roles, city, pasted links with previews, then an account with a starter portfolio', async ({ page }) => {
    const calls = await mockSignupApi(page);
    await page.goto('/join/musician');
    await expect(page.getByRole('heading', { name: 'What you do' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'City you work from' })).toHaveValue('Mumbai');

    await page.getByRole('button', { name: 'Next: your work' }).click();
    await expect(page.getByRole('alert')).toContainText('Pick at least one');
    await page.getByRole('button', { name: 'Drummer', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Drummer', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Percussionist' }).click();
    await page.getByRole('button', { name: 'Next: your work' }).click();

    await expect(page.getByRole('heading', { name: 'Your work' })).toBeFocused();
    const link = page.getByLabel('Paste links to your work');
    await link.fill('not a link');
    await link.press('Enter');
    await expect(page.getByRole('alert')).toContainText('doesn’t look like a web link');
    await link.fill(YOUTUBE);
    await link.press('Enter');
    const cards = page.getByTestId('work-link');
    await expect(cards.first()).toContainText('Live at a sangeet, Bandra (drum cam)');
    await expect(cards.first()).toContainText('YouTube · Riya Desai');
    await expect(cards.first().locator('img')).toHaveAttribute('width', '96');
    // Without a scheme, and a paste adds it straight away.
    await link.focus();
    await link.evaluate(
      (element, text) => {
        const data = new DataTransfer();
        data.setData('text/plain', text);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      },
      SOUNDCLOUD.replace('https://', ''),
    );
    await expect(cards.nth(1)).toContainText('Blue Frog live set');
    await link.fill(SPOTIFY);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(cards.nth(2)).toContainText('Spotify track');
    await link.fill('https://www.youtube.com/watch?v=private-one');
    await link.press('Enter');
    await expect(page.getByRole('alert')).toContainText('can’t be previewed');
    await expect(cards).toHaveCount(3);
    await page.getByRole('button', { name: 'Remove Spotify track' }).click();
    await expect(cards).toHaveCount(2);
    expect(calls.previews).toEqual([YOUTUBE, SOUNDCLOUD, SPOTIFY, 'https://www.youtube.com/watch?v=private-one']);

    await page.getByLabel(/Years of experience/).fill('8');
    await expect(page.getByTestId('headline-preview')).toContainText('Drummer · Percussionist · Mumbai · 8 years');
    await page.getByRole('button', { name: 'Next: your account' }).click();

    await expect(page.getByRole('heading', { name: 'Your account' })).toBeFocused();
    await page.getByLabel('Your name').fill('Riya Desai');
    await page.getByLabel('Email').fill('riya@example.invalid');
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel(/I agree to the Terms/).check();
    await page.getByRole('button', { name: 'Create my account' }).click();

    await expect(page).toHaveURL(/\/jobseeker\?welcome=1$/);
    expect(calls.registers).toHaveLength(1);
    expect(calls.registers[0]).toMatchObject({
      name: 'Riya Desai',
      email: 'riya@example.invalid',
      password: PASSWORD,
      role: 'jobseeker',
      consent: true,
      roles: ['Drummer', 'Percussionist'],
      city: 'Mumbai',
      yearsExperience: 8,
      headline: 'Drummer · Percussionist · Mumbai · 8 years',
      links: [
        { url: YOUTUBE, title: 'Live at a sangeet, Bandra (drum cam)' },
        { url: SOUNDCLOUD, title: 'Blue Frog live set' },
      ],
    });
    expect(String(calls.registers[0].bio)).toMatch(/^I'm a drummer and percussionist based in Mumbai, with 8 years/);

    const welcome = page.getByTestId('welcome-next-step');
    await expect(welcome.getByRole('heading', { name: 'You’re on Verse, Riya.' })).toBeVisible();
    await expect(welcome).toContainText('Your starter portfolio is live with 2 work samples');
    await expect(welcome.getByRole('link', { name: /Request verification/ })).toHaveAttribute(
      'href',
      '/jobseeker/profile?verify=1',
    );
    // The product tour waits while the welcome card shows the next step.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await welcome.getByRole('button', { name: 'Dismiss welcome' }).click();
    await expect(page).toHaveURL(/\/jobseeker$/);
  });

  test('drafting a profile from pasted links shows a review card with sources, and Use this fills the sign-up', async ({
    page,
  }) => {
    await mockSignupApi(page);
    await page.route('**/api/link-import/draft', (route) =>
      route.fulfill({
        json: {
          sources: [
            {
              provider: 'youtube',
              kind: 'video',
              label: 'YouTube',
              url: YOUTUBE,
              title: 'Live set',
              author: null,
              thumbnail: null,
            },
          ],
          draft: {
            headline: 'Session drummer in Mumbai',
            bio: 'I play drums for sessions.',
            roles: ['Artists & performers'],
            genres: [],
            instruments: [],
            city: 'Mumbai',
            yearsExperience: 6,
            credits: [],
            items: [{ url: YOUTUBE, title: 'Live set', caption: 'Live at a sangeet' }],
          },
          aiUsed: false,
          provenance: { headline: YOUTUBE },
        },
      }),
    );
    await page.goto('/join/musician');
    await page.getByRole('button', { name: 'Drummer', exact: true }).click();
    await page.getByRole('button', { name: 'Next: your work' }).click();
    await page.getByLabel('Paste links to your work').fill(YOUTUBE);
    await page.getByLabel('Paste links to your work').press('Enter');
    await page.getByRole('button', { name: 'Draft my profile from these links' }).click();
    await expect(page.getByText('We drafted this from your links. Fix anything wrong.')).toBeVisible();
    await expect(page.getByText('Drafted from your links without AI')).toBeVisible();
    await expect(page.getByText('from YouTube').first()).toBeVisible();
    await page.getByTestId('draft-use').click();
    await expect(page.getByTestId('draft-review-card')).toHaveCount(0);
    await expect(page.getByTestId('headline-preview')).toContainText('Session drummer in Mumbai');
    await expect(page.getByLabel(/Years of experience/)).toHaveValue('6');
  });

  test('the account needs the Terms and Privacy box ticked', async ({ page }) => {
    const calls = await mockSignupApi(page);
    await page.goto('/join/musician');
    await page.getByRole('button', { name: 'Complete my profile later' }).click();
    await page.getByLabel('Your name').fill('Riya Desai');
    await page.getByLabel('Email').fill('riya@example.invalid');
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect(page.getByRole('alert')).toHaveText('Tick the box to agree to the Terms and Privacy Policy.');
    await expect(page.getByLabel(/I agree to the Terms/)).toBeFocused();
    await expect(page.getByLabel(/I agree to the Terms/)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(calls.codeRequests).toHaveLength(0);
    expect(calls.registers).toHaveLength(0);
  });

  test('"complete my profile later" goes straight to the account and sends only what was given', async ({ page }) => {
    const calls = await mockSignupApi(page);
    await page.goto('/join/musician');
    await page.getByRole('button', { name: 'Complete my profile later' }).click();
    await expect(page.getByRole('heading', { name: 'Your account' })).toBeFocused();
    await page.getByLabel('Your name').fill('Kabir Shah');
    await page.getByLabel('Email').fill('kabir@example.invalid');
    await page.getByLabel(/I agree to the Terms/).check();
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await expect
      .poll(() => calls.codeRequests)
      .toEqual([{ email: 'kabir@example.invalid', name: 'Kabir Shah', role: 'jobseeker', consent: true }]);
    await page.getByLabel('Sign-in code').fill('482913');
    await expect(page).toHaveURL(/\/jobseeker\?welcome=1$/);
    expect(calls.starters).toEqual([{ city: 'Mumbai', consent: true }]);
    const welcome = page.getByTestId('welcome-next-step');
    await expect(welcome).toContainText('Add a link to your work');
    await expect(welcome.getByRole('link', { name: 'Complete your profile' })).toHaveAttribute(
      'href',
      '/jobseeker/profile',
    );
  });
});

test.describe('hirer sign-up', () => {
  test('what you are, city and company, then an account; lands on post or urgent request', async ({ page }) => {
    const calls = await mockSignupApi(page);
    await page.goto('/join/hiring');
    await page.getByRole('button', { name: 'Next: your account' }).click();
    await expect(page.getByRole('alert')).toContainText('Choose the closest match');
    await page.getByLabel('Event or wedding company').check();
    await expect(page.getByLabel('Company name')).toBeVisible();
    await page.getByLabel('Company name').fill('Shaadi Beats Events');
    await page.getByRole('button', { name: 'Next: your account' }).click();

    await page.getByLabel('Your name').fill('Anita Kulkarni');
    await page.getByLabel('Email').fill('anita@example.invalid');
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel(/I agree to the Terms/).check();
    await page.getByRole('button', { name: 'Create my account' }).click();

    await expect(page).toHaveURL(/\/employer\?welcome=1$/);
    expect(calls.registers[0]).toMatchObject({
      name: 'Anita Kulkarni',
      role: 'employer',
      consent: true,
      hirerKind: 'event_company',
      city: 'Mumbai',
      companyName: 'Shaadi Beats Events',
    });
    expect(calls.registers[0]).not.toHaveProperty('links');
    const welcome = page.getByTestId('welcome-next-step');
    await expect(welcome.getByRole('link', { name: /Need someone by tomorrow/ })).toHaveAttribute(
      'href',
      '/employer/urgent',
    );
    await expect(welcome.getByRole('link', { name: /Post an opportunity/ })).toHaveAttribute(
      'href',
      '/employer/post-job',
    );
  });

  test('an urgent-request visitor fills the public form first and is only asked to sign up to send it', async ({
    page,
  }) => {
    await mockSignupApi(page);
    await page.goto('/');
    await page.getByRole('link', { name: /Need someone by tomorrow/ }).click();
    await expect(page).toHaveURL(/\/urgent$/);
    // The full hop (draft → /join/hiring → account → confirmation) is covered in urgent-hire.spec.ts.
    await expect(page.getByRole('button', { name: 'Continue to sign up' })).toBeVisible();
  });
});
