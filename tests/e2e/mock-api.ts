import type { Page, Request } from '@playwright/test';

// A mocked Verse API for browser specs: `routes` maps "METHOD /api/path" or "/api/path" to a reply
// (or a function of the request); GET /api/me answers with `user` (signed in) or 401.
export type Reply = { status?: number; body: unknown };
export type Handler = (request: Request) => Reply;

export async function mockApi(page: Page, routes: Record<string, Reply | Handler>, user?: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  if (user) await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '/api');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    calls.push({ method: request.method(), path, body });
    if (path === '/api/me') {
      return route.fulfill({
        status: user ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(user ? { user } : { error: 'Authentication required' }),
      });
    }
    const entry = routes[`${request.method()} ${path}`] ?? routes[path];
    const reply = typeof entry === 'function' ? entry(request) : (entry ?? { body: {} });
    return route.fulfill({
      status: reply.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
  return calls;
}
