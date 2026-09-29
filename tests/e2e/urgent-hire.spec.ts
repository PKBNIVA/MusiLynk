import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API coverage of the "need someone by tomorrow" hirer flow and the musician's
// one-tap response. The real endpoints are covered by backend/test/integration/
// urgent_requests_matching_test.rb and test/services/urgent_matcher_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const hirer = {
  id: 'user-hirer-1',
  name: 'New Studio',
  email: 'studio@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: false,
};

async function mockCommon(page: Page, state: { registered: boolean; urgentRequests: unknown[] }) {
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/auth/methods'))
      return json(route, { emailDelivery: true, signInCodes: false, password: true });
    if (pathname.endsWith('/me')) return state.registered ? json(route, { user: hirer }) : json(route, {}, 401);
    if (pathname.endsWith('/auth/register') && request.method() === 'POST') {
      state.registered = true;
      return json(route, { user: hirer, accessToken: 'qa-hirer-token' }, 201);
    }
    if (pathname === '/api/urgent-requests' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.urgentRequests.push(body);
      return json(route, { id: 'urg_1', notifiedCount: 6, responseTimePromise: 'within 2 hours, 9am–11pm IST' }, 201);
    }
    if (pathname === '/api/urgent-requests/urg_1') {
      return json(route, {
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
    }
    if (pathname === '/api/ai/autocomplete') return json(route, { suggestions: [] });
    return json(route, {});
  });
}

test('signed-out hirer fills the urgent form, signs up, and lands on the confirmation status card', async ({
  page,
}) => {
  const state = { registered: false, urgentRequests: [] as unknown[] };
  await mockCommon(page, state);

  await page.goto('/urgent');
  await expect(page.getByRole('heading', { name: /Find a verified musician/ })).toBeVisible();

  // City defaults to Mumbai already; only the role needs to be entered and committed
  // (AutocompleteInput commits free text on Enter/blur when no suggestion is picked).
  await expect(page.getByRole('combobox', { name: 'City' })).toHaveValue('Mumbai');
  await page.getByRole('combobox', { name: 'Role needed' }).fill('Drummer');
  await page.getByRole('combobox', { name: 'Role needed' }).press('Enter');
  const dateField = page.locator('#urgent-start');
  await expect(dateField).not.toHaveValue('');

  await page.getByRole('button', { name: 'Continue to sign up' }).click();
  // The draft survives the hop through the two-minute hirer sign-up.
  await expect(page).toHaveURL(/\/join\/hiring$/);
  await page.getByLabel('Recording studio').check();
  await page.getByLabel('Studio name').fill('New Studio');
  await page.getByRole('button', { name: 'Next: your account' }).click();
  await page.getByLabel('Your name').fill('New Studio Owner');
  await page.getByLabel('Email').fill('studio@example.invalid');
  // The mocked sign-in methods have no email delivery, so the password field is already shown.
  await page.getByLabel('Password', { exact: true }).fill('LongEnoughPass123!');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page).toHaveURL(/\/urgent$/);
  await expect(page.getByText("We're on it")).toBeVisible();
  await expect(page.getByText('within 2 hours, 9am–11pm IST')).toBeVisible();
  await expect(page.getByText('6', { exact: true })).toBeVisible();

  expect(state.urgentRequests).toHaveLength(1);
  expect(state.urgentRequests[0]).toMatchObject({ roleName: 'Drummer', city: 'Mumbai' });
});

const musicianRequest = {
  id: 'urg_musician_1',
  requester_id: 'user-hirer-2',
  title: 'Bassist needed for showcase',
  role_name: 'Bassist',
  instrument: null,
  city: 'Mumbai',
  currency: 'INR',
  status: 'open',
  start_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  budget_min: null,
  budget_max: null,
  requirements: null,
  requesterName: 'Blue Note Studio',
  requesterVerified: true,
  myResponse: false,
  responseCount: 0,
};

test('musician sees an open urgent request and responds in one tap', async ({ page }) => {
  const musician = {
    id: 'user-musician-1',
    name: 'Ready Musician',
    email: 'musician@example.invalid',
    role: 'jobseeker',
    status: 'active',
    profileComplete: true,
  };
  const state = { responded: [] as unknown[] };
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-musician-token'));
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/me')) return json(route, { user: musician });
    if (pathname === '/api/urgent-requests' && request.method() === 'GET')
      return json(route, { requests: [musicianRequest] });
    if (pathname === '/api/urgent-requests/urg_musician_1/respond' && request.method() === 'POST') {
      state.responded.push(request.postDataJSON());
      return json(route, { ok: true }, 201);
    }
    return json(route, {});
  });

  await page.goto('/jobseeker/urgent');
  await expect(page.getByText('Bassist needed for showcase')).toBeVisible();
  await page.getByRole('button', { name: 'I’m available' }).click();
  await page.getByRole('button', { name: 'Send availability' }).click();

  await expect(page.getByText('Availability sent')).toBeVisible();
  expect(state.responded).toHaveLength(1);
});
