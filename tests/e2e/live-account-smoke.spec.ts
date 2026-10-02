import { expect, test, type APIRequestContext } from '@playwright/test';

// Post-deploy smoke for a signed-in user: signs in with a dedicated jobseeker test account,
// saves a job alert, reads it back, deletes it and signs out. It writes nothing that
// outlives the run and sends no email (a "saved" alert is never delivered).
//
// Inert unless all three are set, so pull requests and forks skip it cleanly:
//   QA_API_BASE_URL     the Rails API including /api (the live QA workflow sets it)
//   QA_SMOKE_EMAIL      repository secret: the test account's email
//   QA_SMOKE_PASSWORD   repository secret: the test account's password
const apiBase = process.env.QA_API_BASE_URL?.replace(/\/$/, '');
const email = process.env.QA_SMOKE_EMAIL?.trim();
const password = process.env.QA_SMOKE_PASSWORD;
const SMOKE_ALERT_PREFIX = 'QA smoke alert';

type Alert = { id: string | number; name?: string };

async function listAlerts(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get(`${apiBase}/job-alerts`, { headers });
  expect(response.status(), 'GET /job-alerts').toBe(200);
  return ((await response.json()).alerts || []) as Alert[];
}

test.describe('live signed-in smoke (dedicated test account)', () => {
  test.skip(
    !apiBase || !email || !password,
    'Set QA_API_BASE_URL, QA_SMOKE_EMAIL and QA_SMOKE_PASSWORD to run the signed-in live smoke.',
  );

  test('sign in, save a job alert, delete it and sign out', async ({ request }) => {
    const login = await request.post(`${apiBase}/auth/login`, { data: { email, password }, failOnStatusCode: false });
    const loginBody = await login.json().catch(() => ({}));
    if (login.status() === 403 && loginBody?.code === 'PASSWORD_LOGIN_DISABLED') {
      throw new Error(
        'Password sign-in is turned off (PASSWORD_LOGIN_ENABLED=false), so the smoke account cannot sign in.',
      );
    }
    expect(login.status(), `POST /auth/login: ${loginBody?.error || ''}`).toBe(200);
    expect(loginBody.user?.role, 'the smoke account must be a jobseeker (job alerts are jobseeker-only)').toBe(
      'jobseeker',
    );
    const headers = { Authorization: `Bearer ${loginBody.accessToken}` };
    const created: Array<string | number> = [];

    try {
      const me = await request.get(`${apiBase}/me`, { headers });
      expect(me.status(), 'GET /me with the new session').toBe(200);
      expect((await me.json()).user?.email).toBe(loginBody.user.email);

      // Clear alerts a previous run could not delete (e.g. it was cancelled mid-way).
      for (const stale of (await listAlerts(request, headers)).filter((alert) =>
        alert.name?.startsWith(SMOKE_ALERT_PREFIX),
      )) {
        await request.delete(`${apiBase}/job-alerts/${stale.id}`, { headers, failOnStatusCode: false });
      }

      const name = `${SMOKE_ALERT_PREFIX} ${new Date().toISOString()}`;
      const create = await request.post(`${apiBase}/job-alerts`, {
        headers,
        data: { name, query: 'musilynk-qa-smoke', frequency: 'saved', active: false },
      });
      expect(create.status(), 'POST /job-alerts').toBe(201);
      const { id } = await create.json();
      expect(id).toBeTruthy();
      created.push(id);

      expect((await listAlerts(request, headers)).map((alert) => String(alert.id))).toContain(String(id));

      const remove = await request.delete(`${apiBase}/job-alerts/${id}`, { headers });
      expect(remove.status(), 'DELETE /job-alerts/:id').toBe(200);
      created.pop();
      expect((await listAlerts(request, headers)).map((alert) => String(alert.id))).not.toContain(String(id));
    } finally {
      // Clean up even when an assertion above failed, then end the session.
      for (const id of created)
        await request
          .delete(`${apiBase}/job-alerts/${id}`, { headers, failOnStatusCode: false })
          .catch(() => undefined);
      const logout = await request.post(`${apiBase}/auth/logout`, { headers, failOnStatusCode: false });
      expect(logout.status(), 'POST /auth/logout').toBe(200);
    }

    // The signed-out token no longer works.
    const after = await request.get(`${apiBase}/me`, { headers, failOnStatusCode: false });
    expect(after.status()).toBe(401);
  });
});
