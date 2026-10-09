import { expect, test, type Request } from '@playwright/test';
import { mockApi, type Reply } from './mock-api';

// R4 keyset paging: the talent directory, the Stage feed and notifications page with opaque cursors
// that now carry the last row's sort key ((rank_score, id) or (created_at, id)). The client must send
// `nextCursor` back verbatim on "load more" and show each row once. Mocked API.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const SELF = {
  id: 'user_1',
  name: 'Priya Menon',
  email: 'priya@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
// What the API now sends: base64url JSON of the last row's key.
const cursor = (key: unknown) => Buffer.from(JSON.stringify(key)).toString('base64url');
const cursorOf = (request: Request) => new URL(request.url()).searchParams.get('cursor');

const pro = (n: number) => ({
  id: `pro-${n}`,
  name: `Keyset Artist ${n}`,
  role: 'jobseeker',
  headline: 'Vocalist · Bollywood',
  location: 'Mumbai',
  skills: ['Vocals'],
  genres: [],
  instruments: [],
  languages: [],
  credits: [],
  openTo: [],
  roles: ['Vocalist'],
  gear: [],
  software: [],
});

const post = (n: number) => ({
  id: `post_${n}`,
  author: { type: 'user', id: 'user_2', name: 'Kabir Shah', avatar: null, verified: false },
  kind: 'update',
  body: `Keyset post number ${n}`,
  media: [],
  linkUrl: null,
  city: 'Mumbai',
  genres: [],
  hashtags: [],
  visibility: 'public',
  status: 'active',
  sharedEntity: null,
  applauseCount: 0,
  commentCount: 0,
  reshareCount: 0,
  applauded: false,
  pinned: false,
  pinnedUntil: null,
  event: null,
  createdAt: `2026-10-0${9 - Math.min(n, 8)}T10:00:00Z`,
  updatedAt: '2026-10-01T10:00:00Z',
});

const note = (n: number) => ({
  id: `note_${n}`,
  type: 'system',
  title: `Keyset notification ${n}`,
  body: null,
  link: null,
  createdAt: '2026-10-08T10:00:00Z',
  readAt: null,
});

test('the talent directory sends the keyset cursor back on "Load more"', async ({ page }) => {
  const next = cursor({ k: [11610, 'pro-3'] });
  const asked: Array<string | null> = [];
  await mockApi(page, {
    'GET /api/public/talent': (request): Reply => {
      const at = cursorOf(request);
      asked.push(at);
      if (!at) return { body: { talent: [1, 2, 3].map(pro), total: 5, nextCursor: next } };
      if (at === next) return { body: { talent: [4, 5].map(pro), total: 5, nextCursor: null } };
      return { status: 400, body: { error: 'This list position is no longer valid.', code: 'INVALID_CURSOR' } };
    },
  });
  await page.goto('/music-professionals');
  await expect(page.getByText('Showing 3 of 5 musicians')).toBeVisible();
  await page.getByRole('button', { name: 'Load more musicians' }).click();
  await expect(page.getByText('Showing 5 of 5 musicians')).toBeVisible();
  await expect(page.getByText('Keyset Artist 5')).toBeVisible();
  expect(asked).toContain(next);
  await expect(page.getByRole('button', { name: 'Load more musicians' })).toHaveCount(0);
});

test('the Stage feed loads the next keyset page and shows each post once', async ({ page }) => {
  const next = cursor({ t: '2026-10-06T10:00:00.000000Z', i: 'post_3' });
  const asked: Array<string | null> = [];
  await mockApi(
    page,
    {
      'GET /api/ai/status': { body: { enabled: false, tasks: [] } },
      'GET /api/acts/me': { body: { acts: [] } },
      'GET /api/organizations': { body: { organizations: [] } },
      'GET /api/stage/events': { body: { city: null, events: [] } },
      'GET /api/stage/feed': (request): Reply => {
        const at = cursorOf(request);
        asked.push(at);
        if (!at) return { body: { posts: [1, 2, 3].map(post), nextCursor: next } };
        // A post repeated across pages (it cannot happen with keyset paging) is still shown once.
        if (at === next) return { body: { posts: [3, 4, 5].map(post), nextCursor: null } };
        return { body: { posts: [], nextCursor: null } };
      },
    },
    SELF,
  );
  await page.goto('/stage');
  await expect(page.getByText('Keyset post number 1')).toBeVisible();
  await page.getByText('Keyset post number 3').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 4000);
  await expect(page.getByText('Keyset post number 5')).toBeVisible();
  await expect(page.getByText('Keyset post number 3')).toHaveCount(1);
  expect(asked).toContain(next);
});

test('notifications load older pages with the keyset cursor', async ({ page }) => {
  const next = cursor({ t: '2026-10-08T10:00:00.000000Z', i: 'note_2' });
  const asked: Array<string | null> = [];
  await mockApi(
    page,
    {
      'GET /api/notifications/unread': { body: { unread: 3, unreadMessages: 0 } },
      'GET /api/notifications/preferences': { body: { emailNotifications: true, paymentsNotify: false } },
      'GET /api/notifications': (request): Reply => {
        const at = cursorOf(request);
        asked.push(at);
        if (!at) return { body: { notifications: [1, 2].map(note), unread: 3, nextCursor: next } };
        return { body: { notifications: [3].map(note), unread: 3, nextCursor: null } };
      },
    },
    SELF,
  );
  await page.goto('/jobseeker/notifications');
  await expect(page.getByText('Keyset notification 2')).toBeVisible();
  await page.getByTestId('notifications-load-more').click();
  await expect(page.getByText('Keyset notification 3')).toBeVisible();
  await expect(page.getByTestId('notification')).toHaveCount(3);
  await expect(page.getByTestId('notifications-load-more')).toHaveCount(0);
  expect(asked).toEqual([null, next]);
});
