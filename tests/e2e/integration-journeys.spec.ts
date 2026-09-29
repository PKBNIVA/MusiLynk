import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test.describe('real frontend and Rails journeys', () => {
  test.skip(
    process.env.QA_INTEGRATION !== 'true',
    'Run against a disposable Rails test database with QA_INTEGRATION=true.',
  );

  for (const role of ['jobseeker', 'employer'] as const) {
    test(`${role} registers, signs out, signs back in, and keeps profile data`, async ({ page, request }) => {
      const email = `qa-${randomUUID()}@example.invalid`;
      const password = 'Harbor-Lantern-4827!';
      const name = role === 'jobseeker' ? 'Integration Artist' : 'Integration Studio';
      const profilePath = `/${role}/profile`;

      // The two-minute sign-up, skipping the questions ("complete my profile later").
      await page.goto(`/auth/${role}`);
      await page.getByRole('link', { name: 'New to Verse? Join in two minutes' }).click();
      await page.getByRole('button', { name: 'Complete my profile later' }).click();
      await page.getByLabel('Your name').fill(name);
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Use a password instead' }).click();
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel(/I agree to the Terms/).check();
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page).toHaveURL(new RegExp(`/${role}\\?welcome=1$`));
      await page.goto(profilePath);
      // The form loads the saved profile first; typing before that finishes would be overwritten.
      await page.waitForLoadState('networkidle');

      const token = await page.evaluate(() => localStorage.getItem('verse_access_token'));
      expect(token).toBeTruthy();
      const apiBase = process.env.QA_API_BASE_URL!;
      const me = await request.get(`${apiBase}/me`, { headers: { Authorization: `Bearer ${token}` } });
      expect(me.status()).toBe(200);
      const meUser = (await me.json()).user;
      expect(meUser).toMatchObject({ email, role });
      // The sign-up's Terms and Privacy box is recorded on the account.
      expect(meUser.consented_at).toBeTruthy();
      const forbidden = await request.get(`${apiBase}/admin/stats`, { headers: { Authorization: `Bearer ${token}` } });
      expect(forbidden.status()).toBe(403);

      // The product tour never opens by itself, on the profile-setup page or anywhere else.
      const tour = page.getByRole('dialog').filter({ hasText: /Step \d+ of \d+/ });
      await expect(tour).toBeHidden();

      if (role === 'jobseeker') {
        await page.getByPlaceholder(/Playback singer/).fill('Integration vocalist');
        await page.getByRole('button', { name: 'Save career profile' }).click();
      } else {
        await page.locator('form input').first().fill('Integration Music Studio');
        await page.getByRole('button', { name: 'Save organization profile' }).click();
      }
      await expect
        .poll(async () => {
          const response = await request.get(`${apiBase}/me`, { headers: { Authorization: `Bearer ${token}` } });
          return (await response.json()).user.profileComplete;
        })
        .toBe(true);

      // The first dashboard visit shows the dismissible three-card strip, never a modal.
      await page.goto(`/${role}`);
      await expect(tour).toBeHidden();
      const strip = page.getByTestId('tour-strip');
      await expect(strip).toBeVisible();
      await strip.getByRole('button', { name: 'Got it' }).click();
      await expect(strip).toBeHidden();

      await page.getByRole('button', { name: 'Open account menu' }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect
        .poll(async () => {
          const revoked = await request.get(`${apiBase}/me`, { headers: { Authorization: `Bearer ${token}` } });
          return revoked.status();
        })
        .toBe(401);
      await expect.poll(() => page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();

      await page.goto(`/auth/${role}`);
      await page.getByLabel('Email').fill(email);
      await page.getByRole('button', { name: 'Use password instead' }).click();
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/${role}`);
      await page.goto(profilePath);
      // The form loads the saved profile first; typing before that finishes would be overwritten.
      await page.waitForLoadState('networkidle');
      if (role === 'jobseeker') {
        await expect(page.getByPlaceholder(/Playback singer/)).toHaveValue('Integration vocalist');
      } else {
        await expect(page.locator('form input').first()).toHaveValue('Integration Music Studio');
      }
    });
  }

  test('a misspelt search is corrected and the directory pages with a cursor', async ({ page, request }) => {
    const apiBase = process.env.QA_API_BASE_URL!;
    const tag = randomUUID().slice(0, 8);
    // Two professionals whose headline says violinist; profiles are listed once saved.
    for (const n of [1, 2]) {
      const registered = await request.post(`${apiBase}/auth/register`, {
        data: {
          name: `Violin ${tag} ${n}`,
          email: `qa-violin-${tag}-${n}@example.invalid`,
          password: 'IntegrationPass123!',
          role: 'jobseeker',
        },
      });
      expect(registered.status()).toBe(201);
      const { accessToken } = await registered.json();
      const saved = await request.put(`${apiBase}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { headline: `Violinist ${tag}`, location: 'Pune', roles: ['Violinist'] },
      });
      expect(saved.status()).toBe(200);
    }

    // The API pages the match with an opaque cursor, and every row is reached once.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `${apiBase}/public/talent?q=${encodeURIComponent(`violinist ${tag}`)}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page1 = await (await request.get(url)).json();
      expect(page1.total).toBe(2);
      seen.push(...page1.talent.map((t: { name: string }) => t.name));
      cursor = page1.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual([`Violin ${tag} 1`, `Violin ${tag} 2`]);

    // The page shows what the misspelling was read as.
    await page.goto(`/music-professionals?q=${encodeURIComponent(`voilinist ${tag}`)}`);
    await expect(page.getByTestId('search-notice')).toContainText(`Showing results for violinist ${tag}`);
    await expect(page.getByRole('heading', { name: `Violin ${tag} 1` })).toBeVisible();
  });
});
