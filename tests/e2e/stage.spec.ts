import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Reply } from './mock-api';

// The Stage (community feed): mocked-API journeys. Live and integration runs use real data.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const SELF = {
  id: 'user_1',
  name: 'Priya Menon',
  email: 'priya@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post_1',
    author: { type: 'user', id: 'user_1', name: 'Priya Menon', avatar: null, verified: true },
    kind: 'update',
    body: 'Wrapped a great session today! #jazz #mumbai',
    media: [],
    linkUrl: null,
    city: 'Mumbai',
    genres: ['Jazz'],
    hashtags: ['jazz', 'mumbai'],
    visibility: 'public',
    status: 'active',
    sharedEntity: null,
    applauseCount: 4,
    commentCount: 1,
    reshareCount: 0,
    applauded: false,
    pinned: false,
    pinnedUntil: null,
    event: null,
    createdAt: '2026-09-28T10:00:00Z',
    updatedAt: '2026-09-28T10:00:00Z',
    ...overrides,
  };
}

const AI_DISABLED: Reply = { body: { enabled: false, tasks: [] } };

async function goToStage(
  page: Page,
  routes: Record<string, Reply | ((r: import('@playwright/test').Request) => Reply)>,
) {
  await mockApi(
    page,
    {
      'GET /api/ai/status': AI_DISABLED,
      'GET /api/acts/me': { body: { acts: [] } },
      'GET /api/organizations': { body: { organizations: [] } },
      'GET /api/stage/events': { body: { city: null, events: [] } },
      ...routes,
    },
    SELF,
  );
  await page.goto('/stage');
  await expect(page.getByRole('heading', { name: 'Stage', exact: true })).toBeVisible();
  await expect(page.getByLabel('Post text').first()).toBeVisible();
}

test.describe('The Stage', () => {
  test('posts as yourself', async ({ page }) => {
    let createdBody: string | undefined;
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [], nextCursor: null } },
      'POST /api/stage/posts': (request) => {
        const data = request.postDataJSON() as { body?: string };
        createdBody = data.body;
        return { status: 201, body: { id: 'post_new', post: post({ id: 'post_new', body: data.body }) } };
      },
    });
    await expect(page.getByText('Posting as')).toBeVisible();
    await expect(page.getByText('Priya Menon')).toBeVisible();
    await page.getByLabel('Post text').fill('Just finished mixing a new single!');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('Just finished mixing a new single!')).toBeVisible();
    expect(createdBody).toBe('Just finished mixing a new single!');
  });

  test('posts as a Page you run', async ({ page }) => {
    let sentHeader: string | null = null;
    await mockApi(
      page,
      {
        'GET /api/ai/status': AI_DISABLED,
        'GET /api/acts/me': { body: { acts: [{ id: 'act_1', name: 'Indigo Collective' }] } },
        'GET /api/organizations': { body: { organizations: [] } },
        'GET /api/stage/feed': { body: { posts: [], nextCursor: null } },
        'POST /api/stage/posts': (request) => {
          sentHeader = request.headers()['x-verse-act-as'] || null;
          const data = request.postDataJSON();
          return {
            status: 201,
            body: {
              id: 'post_page',
              post: post({
                id: 'post_page',
                body: data.body,
                author: { type: 'act', id: 'act_1', name: 'Indigo Collective', verified: false },
              }),
            },
          };
        },
      },
      SELF,
    );
    await page.goto('/stage');
    await page.getByRole('combobox', { name: 'Posting as' }).click();
    await page.getByRole('option', { name: 'Indigo Collective' }).click();
    await page.getByLabel('Post text').fill('Indigo Collective is playing NH7 this weekend!');
    await page.getByRole('button', { name: 'Post' }).click();
    await expect(page.getByText('Indigo Collective is playing NH7 this weekend!')).toBeVisible();
    expect(sentHeader).toBe('act:act_1');
  });

  test('applauds a post, optimistically', async ({ page }) => {
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [post()], nextCursor: null } },
      'POST /api/stage/posts/post_1/applause': { status: 201, body: { ok: true, applauseCount: 5 } },
    });
    const applause = page.getByRole('button', { name: /Applause/ });
    await expect(applause).toHaveText(/Applause \(4\)/);
    await applause.click();
    await expect(applause).toHaveText(/Applause \(5\)/);
    await expect(applause).toHaveAttribute('aria-pressed', 'true');
  });

  test('comments on a post and replies to a comment', async ({ page }) => {
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [post()], nextCursor: null } },
      'GET /api/stage/posts/post_1/comments': {
        body: {
          comments: [
            {
              id: 'c_1',
              postId: 'post_1',
              author: { type: 'user', id: 'user_2', name: 'Sam Rao' },
              body: 'Loved this!',
              status: 'active',
              parentId: null,
              createdAt: '2026-09-28T10:05:00Z',
              updatedAt: '2026-09-28T10:05:00Z',
            },
          ],
        },
      },
      'POST /api/stage/posts/post_1/comments': (request) => {
        const data = request.postDataJSON();
        return {
          status: 201,
          body: {
            id: 'c_2',
            comment: {
              id: 'c_2',
              postId: 'post_1',
              author: { type: 'user', id: 'user_1', name: 'Priya Menon' },
              body: data.body,
              status: 'active',
              parentId: data.parentId || null,
              createdAt: '2026-09-28T10:10:00Z',
              updatedAt: '2026-09-28T10:10:00Z',
            },
          },
        };
      },
    });
    await page.getByRole('button', { name: /^Comment/ }).click();
    await expect(page.getByText('Loved this!')).toBeVisible();
    await page.getByRole('button', { name: 'Reply' }).click();
    await page.getByLabel('Reply to Sam Rao').fill('Thank you!');
    await page.getByRole('button', { name: 'Reply' }).nth(1).click();
    await expect(page.getByText('Thank you!')).toBeVisible();
  });

  test('reshares a post with a comment', async ({ page }) => {
    let sharedId: string | null = null;
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [post()], nextCursor: null } },
      'POST /api/stage/posts': (request) => {
        const data = request.postDataJSON();
        sharedId = data.resharedPostId;
        return { status: 201, body: { id: 'post_reshare', post: post({ id: 'post_reshare', body: data.body }) } };
      },
    });
    await page.getByRole('button', { name: /^Reshare/ }).click();
    await expect(page.getByRole('dialog', { name: "Reshare Priya Menon's post" })).toBeVisible();
    await page.getByLabel('Add a comment', { exact: true }).fill('Check this out!');
    await page.getByRole('button', { name: 'Share to the Stage' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(sharedId).toBe('post_1');
  });

  test('reports a post', async ({ page }) => {
    let reportBody: Record<string, unknown> | null = null;
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [post()], nextCursor: null } },
      'POST /api/reports': (request) => {
        reportBody = request.postDataJSON();
        return { body: { ok: true } };
      },
    });
    await page.getByRole('button', { name: 'Post options' }).click();
    await page.getByRole('menuitem', { name: 'Report' }).click();
    await page.getByRole('radio', { name: 'Spam or scam' }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    expect(reportBody).toMatchObject({ entityType: 'post', entityId: 'post_1', reason: 'Spam or scam' });
  });

  test('follows an author from the feed', async ({ page }) => {
    let followed: Record<string, unknown> | null = null;
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [], nextCursor: null } },
      'GET /api/stage/authors/user/user_2/posts': {
        body: {
          posts: [post({ author: { type: 'user', id: 'user_2', name: 'Sam Rao', verified: false } })],
          nextCursor: null,
        },
      },
      'GET /api/stage/authors/user/user_2/followers': { body: { followersCount: 12, following: false } },
      'POST /api/stage/follows': (request) => {
        followed = request.postDataJSON();
        return { status: 201, body: { ok: true, following: true } };
      },
    });
    await page.goto('/stage/authors/user/user_2');
    await expect(page.getByRole('heading', { name: 'Sam Rao' })).toBeVisible();
    await page.getByRole('button', { name: 'Follow' }).click();
    await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
    expect(followed).toEqual({ followableType: 'user', followableId: 'user_2' });
  });

  test('shares a job to the Stage from the job details page', async ({ page }) => {
    let shareBody: Record<string, unknown> | null = null;
    await mockApi(
      page,
      {
        'GET /api/ai/status': AI_DISABLED,
        'GET /api/acts/me': { body: { acts: [] } },
        'GET /api/organizations': { body: { organizations: [] } },
        'GET /api/jobs/job_1': {
          body: {
            job: {
              id: 'job_1',
              title: 'Session Guitarist',
              company: 'Indigo Studios',
              location: 'Mumbai',
              kind: 'job',
              status: 'published',
              opportunity_kind: 'job',
              type: 'freelance',
              skills: [],
              languages: [],
              screening_questions: [],
              screeningQuestions: [],
              portfolioRequired: false,
              employerName: 'Indigo Studios',
              employerVerified: true,
              demo: false,
            },
          },
        },
        'POST /api/stage/posts': (request) => {
          shareBody = request.postDataJSON();
          return {
            status: 201,
            body: { id: 'post_job_share', post: post({ id: 'post_job_share', kind: 'job_share', body: null }) },
          };
        },
      },
      SELF,
    );
    await page.goto('/jobseeker/jobs/job_1');
    await page.getByRole('button', { name: 'Share to the Stage' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share Session Guitarist to the Stage' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Share to the Stage' }).click();
    expect(shareBody).toMatchObject({ sharedJobId: 'job_1' });
  });

  test('tag page lists posts with that hashtag', async ({ page }) => {
    await mockApi(
      page,
      {
        'GET /api/ai/status': AI_DISABLED,
        'GET /api/acts/me': { body: { acts: [] } },
        'GET /api/organizations': { body: { organizations: [] } },
        'GET /api/stage/tags/jazz': { body: { posts: [post()], nextCursor: null } },
      },
      SELF,
    );
    await page.goto('/stage/tags/jazz');
    await expect(page.getByRole('heading', { name: 'jazz' })).toBeVisible();
    await expect(page.getByText('Wrapped a great session today!', { exact: false })).toBeVisible();
  });

  test('an unavailable shared job shows a graceful message', async ({ page }) => {
    await goToStage(page, {
      'GET /api/stage/feed': {
        body: {
          posts: [post({ kind: 'job_share', body: null, sharedEntity: { type: 'job', unavailable: true } })],
          nextCursor: null,
        },
      },
    });
    await expect(page.getByText('This job is no longer available.')).toBeVisible();
  });

  test('mobile layout: the feed and composer fit at 390px with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [post()], nextCursor: null } },
    });
    await expect(page.getByLabel('Post text')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('the pinned Monday system post leads the feed, above a newer post', async ({ page }) => {
    const pinnedRoundup = post({
      id: 'post_roundup',
      kind: 'system',
      author: { type: 'system', id: 'verse', name: 'Verse', avatar: null, system: true },
      body: "This week: who's looking, who's free. Comment with your roles and free dates.",
      pinned: true,
      pinnedUntil: '2026-10-05T04:30:00Z',
      createdAt: '2026-09-28T04:30:00Z',
    });
    const newer = post({ id: 'post_newer', body: 'Just landed a new gig!', createdAt: '2026-09-29T09:00:00Z' });
    await goToStage(page, {
      'GET /api/stage/feed': { body: { posts: [pinnedRoundup, newer], nextCursor: null } },
    });
    const posts = page.locator('article');
    await expect(posts.first()).toContainText('Pinned');
    await expect(posts.first()).toContainText("This week: who's looking");
    await expect(posts.nth(1)).toContainText('Just landed a new gig!');
  });

  test('the upcoming events strip shows the next events and offers an ICS download', async ({ page }) => {
    const event = post({
      id: 'post_event',
      kind: 'event',
      body: null,
      city: 'Mumbai',
      event: {
        title: 'Open Mic Night',
        startsAt: '2026-10-05T13:30:00Z',
        venue: 'The Attic',
        city: 'Mumbai',
        link: null,
        featured: false,
      },
    });
    await goToStage(page, {
      'GET /api/stage/events': { body: { city: 'Mumbai', events: [event] } },
      'GET /api/stage/feed': { body: { posts: [], nextCursor: null } },
    });
    await expect(page.getByRole('heading', { name: 'Upcoming in Mumbai' })).toBeVisible();
    await expect(page.getByText('Open Mic Night')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ICS' })).toHaveAttribute('href', /\/stage\/posts\/post_event\/ics/);
  });
});
