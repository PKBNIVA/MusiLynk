import { expect, test, type Page, type Route } from '@playwright/test';

// The client data cache (src/app/lib/dataCache.ts): lists come back instantly on Back with no request,
// a message shows at once and reconciles with the server, and a failed send rolls back.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const ME = 'me-1';
const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute)).toISOString();
const person = (n: number) => ({
  id: `u${n}`,
  name: `Musician ${n}`,
  role: 'jobseeker',
  headline: `Session player ${n}`,
  location: 'Mumbai',
  verified: n % 2 === 0,
  skills: [],
  genres: ['Jazz'],
  instruments: ['Guitar'],
  languages: [],
  credits: [],
  openTo: [],
  roles: ['Guitarist'],
  gear: [],
  software: [],
  demo: false,
});

/** Mocks the public talent API and counts every API request by method and path. */
async function mockTalent(page: Page) {
  const calls: string[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api/, '');
    calls.push(`${request.method()} ${path}${url.search}`);
    if (path === '/public/talent') {
      const people = Array.from({ length: 6 }, (_, i) => person(i + 1));
      return json(route, { talent: people, total: people.length, nextCursor: null });
    }
    const one = /^\/public\/talent\/(u\d+)$/.exec(path);
    if (one) return json(route, { professional: person(Number(one[1].slice(1))), portfolio: [] });
    return json(route, {});
  });
  return calls;
}

const listCalls = (calls: string[]) => calls.filter((c) => /GET \/public\/talent(\?|$)/.test(c));

test.describe('lists and records', () => {
  test('Back to the directory shows the list instantly from memory, with no list request', async ({ page }) => {
    const calls = await mockTalent(page);
    await page.goto('/music-professionals');
    await expect(page.getByTestId('talent-card').first()).toBeVisible();
    expect(listCalls(calls)).toHaveLength(1);

    await page.getByRole('link', { name: 'Musician 2' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Musician 2' })).toBeVisible();
    await page.goBack();
    // Instant: the cards are there before any network round trip could have answered.
    await expect(page.getByTestId('talent-card')).toHaveCount(6);
    await page.waitForTimeout(500);
    expect(listCalls(calls), calls.join('\n')).toHaveLength(1);
  });

  test('hovering a card prefetches its profile once; opening it needs no request', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Hover is a pointer gesture; the phone variant below covers touch.');
    const calls = await mockTalent(page);
    await page.goto('/music-professionals');
    const link = page.getByRole('link', { name: 'Musician 3' });
    await link.hover();
    await expect.poll(() => calls.filter((c) => c.includes('/public/talent/u3')).length).toBe(1);
    await link.hover();
    await page.mouse.move(0, 0);
    await link.hover();
    await page.waitForTimeout(300);
    expect(calls.filter((c) => c.includes('/public/talent/u3'))).toHaveLength(1);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Musician 3' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(calls.filter((c) => c.includes('/public/talent/u3'))).toHaveLength(1);
  });

  test('on a phone the first touch on a card prefetches its profile', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch only.');
    const calls = await mockTalent(page);
    await page.goto('/music-professionals');
    const link = page.getByRole('link', { name: 'Musician 4' });
    await link.dispatchEvent('touchstart');
    await expect.poll(() => calls.filter((c) => c.includes('/public/talent/u4')).length).toBe(1);
  });

  test('a 3-page browse (list, profile, back, another profile) makes one list request and one per profile', async ({
    page,
  }) => {
    const calls = await mockTalent(page);
    await page.goto('/music-professionals');
    await expect(page.getByTestId('talent-card').first()).toBeVisible();
    await page.getByRole('link', { name: 'Musician 1' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Musician 1' })).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('talent-card')).toHaveCount(6);
    await page.getByRole('link', { name: 'Musician 5' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Musician 5' })).toBeVisible();
    await page.waitForTimeout(400);
    const gets = calls.filter((c) => c.startsWith('GET /public/talent'));
    expect(listCalls(calls)).toHaveLength(1);
    // Hover/touch prefetch may have fetched the profile before the click; either way each profile loads once.
    expect(gets.filter((c) => c.includes('/public/talent/u1'))).toHaveLength(1);
    expect(gets.filter((c) => c.includes('/public/talent/u5'))).toHaveLength(1);
  });
});

test.describe('messages', () => {
  type Msg = { id: string; senderId: string; body: string; createdAt: string; readAt: string | null };
  async function mockInbox(page: Page, sendStatus: number) {
    const state = {
      sent: [] as string[],
      thread: [{ id: 'm1', senderId: 'other-1', body: 'Hello there', createdAt: at(0), readAt: at(1) }] as Msg[],
    };
    const json = (route: Route, body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await page.addInitScript(() => {
      localStorage.setItem('musilynk_access_token', 'qa-token');
      localStorage.setItem('musilynk-tour-v2-jobseeker', 'done');
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^.*\/api/, '');
      if (path === '/me')
        return json(route, {
          user: {
            id: ME,
            name: 'Viewer Person',
            email: 'viewer@example.invalid',
            role: 'jobseeker',
            status: 'active',
            profileComplete: true,
          },
        });
      if (path === '/conversations')
        return json(route, {
          conversations: [
            {
              id: 'c1',
              counterpartId: 'other-1',
              counterpartName: 'Counterpart One',
              candidateName: 'Viewer Person',
              employerName: 'Counterpart One',
              lastMessage: 'Hello there',
              lastMessageAt: at(0),
              lastMessageFromMe: false,
              unreadCount: 0,
            },
          ],
        });
      if (path === '/conversations/c1/messages' && request.method() === 'POST') {
        const body = request.postDataJSON().body as string;
        state.sent.push(body);
        // Slow enough to observe the optimistic bubble before the server answers.
        await new Promise((r) => setTimeout(r, 700));
        if (sendStatus !== 201)
          return json(route, { error: 'Unable to send right now.', code: 'SEND_FAILED' }, sendStatus);
        const message = {
          id: `sent-${state.sent.length}`,
          senderId: ME,
          body,
          createdAt: new Date().toISOString(),
          readAt: null,
        };
        state.thread.push(message);
        return json(route, { message }, 201);
      }
      if (path === '/conversations/c1/messages')
        return json(route, { messages: state.thread, truncated: false, limit: 200 });
      return json(route, {});
    });
    return state;
  }

  test('a sent message appears at once, marked as sending, then reconciles with the server copy', async ({ page }) => {
    const state = await mockInbox(page, 201);
    await page.goto('/jobseeker/messages?c=c1');
    const composer = page.getByRole('textbox', { name: /message/i }).first();
    await composer.fill('On my way');
    await composer.press('Enter');
    const pending = page.locator('[data-testid="message"][data-pending="true"]');
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText('On my way');
    await expect(page.getByTestId('read-receipt')).toHaveText('Sending…');
    await expect(composer).toHaveValue('');
    await expect(pending).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-testid="message"][data-mine="true"]')).toHaveCount(1);
    await expect(page.getByTestId('read-receipt')).toHaveText('Sent');
    expect(state.sent).toEqual(['On my way']);
  });

  test('a failed send removes the optimistic message, restores the draft and toasts', async ({ page }) => {
    await mockInbox(page, 503);
    await page.goto('/jobseeker/messages?c=c1');
    const composer = page.getByRole('textbox', { name: /message/i }).first();
    await composer.fill('Will this send?');
    await composer.press('Enter');
    await expect(page.locator('[data-testid="message"][data-pending="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="message"][data-pending="true"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('[data-testid="message"][data-mine="true"]')).toHaveCount(0);
    await expect(composer).toHaveValue('Will this send?');
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /Unable to send/ })
        .first(),
    ).toBeVisible();
  });
});
