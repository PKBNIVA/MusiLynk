import { expect, test, type Page } from '@playwright/test';

// A-28/A-29: an expired session on the Stage signs the person out and sends them to sign in, keeping
// the post they were typing. A-38: the follower count moves when they follow. Mocked API only.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const SELF = {
  id: 'user_1',
  name: 'Priya Menon',
  email: 'priya@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

type State = { signedIn: boolean; followers: number; following: boolean };

async function mockStage(page: Page, state: State) {
  // Seeds the token once per tab, so a redirect after expiry is not undone by this init script.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.setItem('verse_access_token', 'qa-token');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '/api');
    const key = `${request.method()} ${path}`;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/me') {
      return state.signedIn ? reply({ user: SELF }) : reply({ error: 'Authentication required' }, 401);
    }
    if (key === 'POST /api/stage/posts') {
      state.signedIn = false;
      return reply({ error: 'Authentication required' }, 401);
    }
    if (key === 'GET /api/stage/feed') return reply({ posts: [], nextCursor: null });
    if (key === 'GET /api/stage/events') return reply({ city: null, events: [] });
    if (key === 'GET /api/ai/status') return reply({ enabled: false, tasks: [] });
    if (key === 'GET /api/acts/me') return reply({ acts: [] });
    if (key === 'GET /api/organizations') return reply({ organizations: [] });
    if (key === 'GET /api/stage/authors/user/user_2')
      return reply({ author: { type: 'user', id: 'user_2', name: 'Asha Rao', verified: true } });
    if (key === 'GET /api/stage/authors/user/user_2/posts') return reply({ posts: [], nextCursor: null });
    if (key === 'GET /api/stage/authors/user/user_2/followers')
      return reply({ followersCount: state.followers, following: state.following });
    if (key === 'POST /api/stage/follows') {
      state.followers += 1;
      state.following = true;
      return reply({ ok: true, following: true }, 201);
    }
    if (request.method() === 'DELETE' && path.startsWith('/api/stage/follows')) {
      state.followers -= 1;
      state.following = false;
      return reply({ ok: true, following: false });
    }
    return reply({});
  });
}

test('an expired session on the Stage signs out, redirects to sign-in and keeps the unsent post', async ({ page }) => {
  const state: State = { signedIn: true, followers: 0, following: false };
  await mockStage(page, state);
  await page.goto('/stage');
  const draft = 'Opening for The Weekend Band at Blue Frog on Friday, come by!';
  await page.getByLabel('Post text').fill(draft);
  await page.getByRole('button', { name: 'Post', exact: true }).click();

  await expect(page).toHaveURL(/\/auth\/jobseeker/);
  await expect(page.getByTestId('session-expired')).toHaveText('Your session expired. Sign in to continue.');
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('verse_return_to'))).toBe('/stage');

  // Signing in again brings the person back to the Stage with the post still in the composer.
  state.signedIn = true;
  await page.evaluate(() => localStorage.setItem('verse_access_token', 'qa-token-2'));
  await page.goto('/stage');
  await expect(page.getByLabel('Post text')).toHaveValue(draft);
});

test('the follower count on an author page moves when you follow and unfollow', async ({ page }) => {
  await mockStage(page, { signedIn: true, followers: 12, following: false });
  await page.goto('/stage/authors/user/user_2');
  await expect(page.getByText('12 followers')).toBeVisible();
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(page.getByText('13 followers')).toBeVisible();
  await page.getByRole('button', { name: 'Following' }).click();
  await expect(page.getByText('12 followers')).toBeVisible();
});

test('a Stage with only system posts shows one roundup card and says what to do next', async ({ page }) => {
  const state: State = { signedIn: true, followers: 0, following: false };
  await mockStage(page, state);
  const post = (n: number) => ({
    id: `sys_${n}`,
    kind: 'system',
    body: `MusiLynk update number ${n}`,
    author: { type: 'system', id: 'verse', name: 'MusiLynk', system: true },
    createdAt: '2026-09-30T10:00:00Z',
  });
  await page.route('**/api/stage/feed**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ posts: [1, 2, 3, 4, 5].map(post), nextCursor: null }),
    }),
  );
  await page.goto('/stage');
  await expect(page.getByTestId('system-roundup')).toHaveCount(1);
  await expect(page.getByTestId('system-roundup')).toContainText('and 1 more');
  await expect(
    page.getByText('Nothing from musicians yet. Share an update above to start the conversation.'),
  ).toBeVisible();
});
