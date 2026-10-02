import { expect, test, type Page } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Web push opt-in and settings against the mock API. The page's Notification, PushManager and
// service worker are replaced with stubs, so no real permission prompt or push service is involved.
// The real endpoints, encryption at rest and delivery are covered by backend/test/integration/
// push_api_test.rb and test/jobs/push_delivery_job_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const musician = {
  id: 'qa-push-musician',
  name: 'Asha Rao',
  email: 'asha@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
const hirer = {
  id: 'qa-push-hirer',
  name: 'New Studio',
  email: 'studio@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

type Stub = { permission?: NotificationPermission; subscribed?: boolean; userAgent?: string; standalone?: boolean };

async function stubBrowser(
  page: Page,
  { permission = 'default', subscribed = false, userAgent, standalone }: Stub = {},
) {
  await page.addInitScript(
    ({ permission, subscribed, userAgent, standalone }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__push = { permissionRequests: 0, subscribes: 0, unsubscribes: 0 };
      const counters = w.__push as Record<string, number>;
      let subscription: unknown = subscribed
        ? {
            endpoint: 'https://fcm.googleapis.com/fcm/send/qa-existing',
            toJSON: () => ({
              endpoint: 'https://fcm.googleapis.com/fcm/send/qa-existing',
              keys: { p256dh: 'p', auth: 'a' },
            }),
            unsubscribe: async () => {
              counters.unsubscribes += 1;
              subscription = null;
              return true;
            },
          }
        : null;
      const pushManager = {
        getSubscription: async () => subscription,
        subscribe: async () => {
          counters.subscribes += 1;
          subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/qa-new',
            toJSON: () => ({
              endpoint: 'https://fcm.googleapis.com/fcm/send/qa-new',
              keys: { p256dh: 'BPublic', auth: 'secret' },
            }),
            unsubscribe: async () => {
              counters.unsubscribes += 1;
              subscription = null;
              return true;
            },
          };
          return subscription;
        },
      };
      const registration = { pushManager };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      });
      w.PushManager = function PushManager() {};
      let current = permission;
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          get permission() {
            return current;
          },
          requestPermission: async () => {
            counters.permissionRequests += 1;
            current = 'granted';
            return 'granted';
          },
        },
      });
      if (userAgent) Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent });
      if (standalone !== undefined)
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
      if (userAgent) {
        // iOS Safari offers no PushManager outside an installed web app.
        if (!standalone) delete (w as { PushManager?: unknown }).PushManager;
      }
    },
    { permission, subscribed, userAgent, standalone },
  );
}

type Api = { enabled: boolean; user: typeof musician | typeof hirer };

async function mockApi(page: Page, { enabled, user }: Api) {
  const calls: { subscriptions: unknown[]; deleted: unknown[]; preferences: unknown[] } = {
    subscriptions: [],
    deleted: [],
    preferences: [],
  };
  let prefs = { urgent: true, messages: false, bookings: false };
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/me') return reply({ user });
    if (pathname === '/api/push/config')
      return reply(
        enabled
          ? {
              enabled: true,
              publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
            }
          : { enabled: false, publicKey: null },
      );
    if (pathname === '/api/push/subscriptions' && request.method() === 'POST') {
      calls.subscriptions.push(request.postDataJSON());
      return reply({ ok: true, id: 'push_1' }, 201);
    }
    if (pathname === '/api/push/subscriptions' && request.method() === 'DELETE') {
      calls.deleted.push(request.postDataJSON());
      return reply({ ok: true });
    }
    if (pathname === '/api/push/preferences') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as { preferences: Partial<typeof prefs> };
        calls.preferences.push(body);
        prefs = { ...prefs, ...body.preferences };
      }
      return reply({ preferences: prefs, devices: 1 });
    }
    if (pathname === '/api/urgent-requests' && request.method() === 'POST')
      return reply({ id: 'urg_1', notifiedCount: 6, responseTimePromise: 'within 2 hours, 9am–11pm IST' }, 201);
    if (pathname === '/api/urgent-requests/urg_1')
      return reply({
        request: {
          id: 'urg_1',
          title: 'Drummer needed in Mumbai',
          status: 'open',
          notified_count: 6,
          responseCount: 0,
          city: 'Mumbai',
          role_name: 'Drummer',
        },
      });
    if (pathname === '/api/urgent-requests') return reply({ requests: [], total: 0, hasMore: false });
    if (pathname === '/api/ai/autocomplete') return reply({ suggestions: [] });
    return reply({});
  });
  return calls;
}

const counters = (page: Page) => page.evaluate(() => (window as unknown as { __push: Record<string, number> }).__push);

test('a musician on the urgent requests page is offered gig alerts, and nothing is requested until they say yes', async ({
  page,
}) => {
  await stubBrowser(page);
  const calls = await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker/urgent');
  const prompt = page.getByTestId('push-opt-in');
  await expect(prompt.getByRole('heading', { name: 'Get urgent gig alerts' })).toBeVisible();
  expect((await counters(page)).permissionRequests).toBe(0);

  await prompt.getByRole('button', { name: 'Turn on alerts' }).click();
  await expect(prompt).toBeHidden();
  expect(await counters(page)).toMatchObject({ permissionRequests: 1, subscribes: 1 });
  expect(calls.subscriptions).toEqual([
    { endpoint: 'https://fcm.googleapis.com/fcm/send/qa-new', keys: { p256dh: 'BPublic', auth: 'secret' } },
  ]);
});

test('"Not now" hides the prompt and it stays away on the next visit', async ({ page }) => {
  await stubBrowser(page);
  await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker/urgent');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('push-opt-in')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Matches for you' })).toBeVisible();
  await expect(page.getByTestId('push-opt-in')).toHaveCount(0);
});

test('the prompt never appears on a first page load outside the urgent flow', async ({ page }) => {
  await stubBrowser(page);
  await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker');
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await page.goto('/jobseeker/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByTestId('push-opt-in')).toHaveCount(0);
  expect((await counters(page)).permissionRequests).toBe(0);
});

test('a hirer is offered response alerts only after posting an urgent request', async ({ page }) => {
  await stubBrowser(page);
  await mockApi(page, { enabled: true, user: hirer });
  await page.goto('/urgent');
  await expect(page.getByRole('heading', { name: /Find a verified musician/ })).toBeVisible();
  await expect(page.getByTestId('push-opt-in')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Role needed' }).fill('Drummer');
  await page.getByRole('combobox', { name: 'Role needed' }).press('Enter');
  await chooseOption(page.getByLabel('Budget'), '₹5,000 – ₹10,000');
  await page.getByLabel('Short note').fill('Two sets, gear provided.');
  await page.getByRole('button', { name: 'Post urgent need' }).click();

  await expect(page.getByText("We're on it")).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Get an alert the moment a musician responds' })).toBeVisible();
});

test('the prompt and the settings card are hidden entirely when the server has push switched off', async ({ page }) => {
  await stubBrowser(page);
  await mockApi(page, { enabled: false, user: musician });
  await page.goto('/jobseeker/urgent');
  await expect(page.getByRole('tab', { name: 'Matches for you' })).toBeVisible();
  await expect(page.getByTestId('push-opt-in')).toHaveCount(0);
  await page.goto('/jobseeker/settings');
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  await expect(page.getByText('Push notifications')).toHaveCount(0);
});

test('iPhone Safari outside an installed app is told to add Verse to the home screen', async ({ page }) => {
  await stubBrowser(page, {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    standalone: false,
  });
  await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker/urgent');
  await expect(page.getByTestId('push-opt-in')).toContainText('Add Verse to your home screen to get alerts');
  await expect(page.getByRole('button', { name: 'Turn on alerts' })).toHaveCount(0);
});

test('a browser that has blocked notifications gets a plain explanation instead of a dead button', async ({ page }) => {
  await stubBrowser(page, { permission: 'denied' });
  await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker/urgent');
  await expect(page.getByTestId('push-opt-in')).toContainText('Notifications are blocked');
  await expect(page.getByRole('button', { name: 'Turn on alerts' })).toHaveCount(0);
});

test('settings shows the push toggles with urgent on, saves a change and can turn this device off', async ({
  page,
}) => {
  await stubBrowser(page, { subscribed: true, permission: 'granted' });
  const calls = await mockApi(page, { enabled: true, user: musician });
  await page.goto('/jobseeker/settings');
  const card = page.getByTestId('push-settings');
  await expect(card.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
  await expect(card.getByText('Alerts are on for this device.')).toBeVisible();
  await expect(card.getByRole('switch', { name: 'Urgent requests' })).toBeChecked();
  await expect(card.getByRole('switch', { name: 'New messages' })).not.toBeChecked();
  await expect(card.getByRole('switch', { name: 'Bookings' })).not.toBeChecked();

  await card.getByRole('switch', { name: 'New messages' }).click();
  await expect(card.getByRole('switch', { name: 'New messages' })).toBeChecked();
  expect(calls.preferences).toEqual([{ preferences: { messages: true } }]);

  await card.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(card.getByText('Alerts are off for this device.')).toBeVisible();
  expect(calls.deleted).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/qa-existing' }]);
  expect((await counters(page)).unsubscribes).toBe(1);
});
