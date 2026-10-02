import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock-api';

// Bandmate invites with the mocked API: the owner invites (a MusiLynk musician, a shared link), watches
// pending invites and resends or revokes them; the invitee accepts or declines in the Invites section;
// a stranger following a link signs in and lands back on the accept screen. Joining needs an Accept.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const owner = {
  id: 'qa-owner',
  name: 'Olive Owner',
  email: 'owner@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};
const rohan = { ...owner, id: 'qa-rohan', name: 'Rohan Tabla', email: 'rohan@example.invalid' };
const act = {
  id: 'act1',
  name: 'The Night Owls',
  act_type: 'band',
  status: 'active',
  genres: [],
  lineup_size: 4,
  members: [{ id: 'm1', userId: 'qa-owner', displayName: 'Olive Owner', roleName: 'Leader', isLeader: true }],
};
const soon = new Date(Date.now() + 6 * 86_400_000).toISOString();
const pendingUserInvite = {
  id: 'inv1',
  actId: 'act1',
  kind: 'user',
  status: 'pending',
  roleName: 'Tabla',
  instrument: 'Tabla',
  inviteeName: 'Rohan Tabla',
  expiresAt: soon,
  createdAt: new Date().toISOString(),
  canResend: true,
};

async function dismissTour(page: Page) {
  await page.addInitScript(() => localStorage.setItem('verse-tour-v2-jobseeker', 'done'));
}

test('an owner invites a MusiLynk musician, then resends and revokes the pending invite', async ({ page }) => {
  await dismissTour(page);
  let invites: unknown[] = [];
  const calls = await mockApi(
    page,
    {
      '/api/acts/me': { body: { acts: [act], memberships: [] } },
      '/api/act-invites/mine': { body: { invites: [] } },
      '/api/acts/act1/invitees': {
        body: {
          musicians: [{ id: 'qa-rohan', name: 'Rohan Tabla', roles: ['Tabla'], location: 'Pune', verified: false }],
        },
      },
      'GET /api/acts/act1/invites': () => ({ body: { invites } }),
      'POST /api/acts/act1/invites': () => {
        invites = [pendingUserInvite];
        return { status: 201, body: { invite: pendingUserInvite } };
      },
      'POST /api/acts/act1/invites/inv1/resend': { body: { invite: pendingUserInvite } },
      'DELETE /api/acts/act1/invites/inv1': () => {
        invites = [];
        return { body: { invite: { ...pendingUserInvite, status: 'revoked' } } };
      },
    },
    owner,
  );
  await page.goto('/jobseeker/acts');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Invite bandmate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Invite a bandmate' })).toBeVisible();
  await dialog.getByLabel(/Search by name/).fill('Rohan');
  await dialog.getByRole('button', { name: /Rohan Tabla/ }).click();
  await dialog.getByLabel('Role in the act').fill('Tabla');
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByText('Invite sent')).toBeVisible();

  const created = calls.find((c) => c.method === 'POST' && c.path === '/api/acts/act1/invites');
  expect(created?.body).toMatchObject({ kind: 'user', userId: 'qa-rohan', roleName: 'Tabla' });

  const pending = page.getByTestId('pending-invites-act1');
  await expect(pending).toContainText('Rohan Tabla');
  await expect(pending).toContainText('Waiting for a reply');
  await expect(page.getByText('Rohan Tabla').first()).toBeVisible();

  await page.getByRole('button', { name: 'Resend invite to Rohan Tabla' }).click();
  await expect(page.getByText('Invite sent again')).toBeVisible();

  await page.getByRole('button', { name: 'Revoke invite for Rohan Tabla' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Revoke the invite for Rohan Tabla?');
  await confirm.getByRole('button', { name: 'Keep as is' }).click();
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  await page.getByRole('button', { name: 'Revoke invite for Rohan Tabla' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke invite' }).click();
  await expect(pending).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/acts/act1/invites/inv1']);
});

test('an owner can make a one-use link to share on WhatsApp', async ({ page }) => {
  await dismissTour(page);
  const calls = await mockApi(
    page,
    {
      '/api/acts/me': { body: { acts: [act], memberships: [] } },
      '/api/act-invites/mine': { body: { invites: [] } },
      'POST /api/acts/act1/invites': {
        status: 201,
        body: {
          invite: { ...pendingUserInvite, id: 'inv2', kind: 'link', inviteeName: null },
          link: 'https://musilynk.example/invites/tok123',
        },
      },
    },
    owner,
  );
  await page.goto('/jobseeker/acts');
  await page.getByRole('button', { name: 'Invite bandmate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Share a link' }).click();
  await dialog.getByLabel('Role in the act').fill('Keys');
  await dialog.getByRole('button', { name: 'Create link' }).click();
  await expect(dialog.getByLabel('Invite link')).toHaveValue('https://musilynk.example/invites/tok123');
  await expect(dialog.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/\?text=.*tok123/,
  );
  expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ kind: 'link', roleName: 'Keys' });
});

test('an invited musician sees the invite, accepts one and declines another', async ({ page }) => {
  await dismissTour(page);
  const mine = [
    {
      id: 'i1',
      actId: 'act1',
      actName: 'The Night Owls',
      inviterName: 'Olive Owner',
      roleName: 'Tabla',
      instrument: 'Tabla',
      status: 'pending',
      expiresAt: soon,
      createdAt: soon,
    },
    {
      id: 'i2',
      actId: 'act2',
      actName: 'Monsoon Collective',
      inviterName: 'Meera Das',
      roleName: 'Keys',
      status: 'pending',
      expiresAt: soon,
      createdAt: soon,
    },
  ];
  let inbox = [...mine];
  const calls = await mockApi(
    page,
    {
      '/api/acts/me': { body: { acts: [], memberships: [] } },
      'GET /api/act-invites/mine': () => ({ body: { invites: inbox } }),
      'POST /api/act-invites/i1/accept': () => {
        inbox = inbox.filter((i) => i.id !== 'i1');
        return { body: { invite: mine[0], member: { id: 'm9' } } };
      },
      'POST /api/act-invites/i2/decline': () => {
        inbox = inbox.filter((i) => i.id !== 'i2');
        return { body: { invite: mine[1] } };
      },
    },
    rohan,
  );
  await page.goto('/jobseeker/acts');
  const invites = page.getByRole('region', { name: 'Invites' });
  await expect(invites).toContainText('Olive Owner invited you to join The Night Owls');
  await expect(invites).toContainText('Meera Das invited you to join Monsoon Collective');
  expect(calls.some((c) => c.method === 'POST')).toBe(false);

  await invites.getByRole('button', { name: 'Accept invite to The Night Owls' }).click();
  await expect(invites).not.toContainText('The Night Owls');
  await invites.getByRole('button', { name: 'Decline invite to Monsoon Collective' }).click();
  await expect(page.getByRole('region', { name: 'Invites' })).toHaveCount(0);
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/act-invites/i1/accept',
    '/api/act-invites/i2/decline',
  ]);
});

test('a member can leave a band after confirming', async ({ page }) => {
  await dismissTour(page);
  const calls = await mockApi(
    page,
    {
      '/api/acts/me': {
        body: { acts: [], memberships: [{ actId: 'act1', actName: 'The Night Owls', roleName: 'Tabla' }] },
      },
      '/api/act-invites/mine': { body: { invites: [] } },
      'POST /api/acts/act1/leave': { body: { ok: true } },
    },
    rohan,
  );
  await page.goto('/jobseeker/acts');
  await page.getByRole('button', { name: 'Leave The Night Owls' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Leave The Night Owls?');
  expect(calls.some((c) => c.path.endsWith('/leave'))).toBe(false);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave band' }).click();
  await expect.poll(() => calls.some((c) => c.method === 'POST' && c.path === '/api/acts/act1/leave')).toBe(true);
});

test('a stranger following an invite link signs in and lands back on the accept screen', async ({ page }) => {
  await dismissTour(page);
  let signedIn = false;
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const invite = {
    id: 'i3',
    actId: 'act1',
    actName: 'The Night Owls',
    inviterName: 'Olive Owner',
    roleName: 'Keys',
    status: 'pending',
    expiresAt: soon,
    createdAt: soon,
    addressed: false,
  };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api/, '/api');
    calls.push({ method: request.method(), path, body: request.postData() });
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/me')
      return signedIn ? json(200, { user: rohan }) : json(401, { error: 'Authentication required' });
    if (path === '/api/auth/methods') return json(200, { signInCodes: true, password: true });
    if (path === '/api/auth/login') {
      signedIn = true;
      return json(200, { user: rohan, accessToken: 'qa-token' });
    }
    if (path === '/api/act-invites/preview') return json(200, { invite });
    if (path === '/api/act-invites/accept') return json(200, { invite, member: { id: 'm1' } });
    return json(200, {});
  });
  await page.goto('/invites/tok123');
  await expect(page.getByRole('heading', { name: 'Olive Owner invited you to join The Night Owls' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept and join' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in to answer' }).click();
  await expect(page).toHaveURL(/\/auth\/jobseeker/);
  await page.getByRole('button', { name: 'Use password instead' }).click();
  await page.getByLabel('Email').fill('rohan@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('SomePassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/invites\/tok123$/);
  await page.getByRole('button', { name: 'Accept and join' }).click();
  await expect(page.getByRole('heading', { name: "You're in The Night Owls" })).toBeVisible();
  const accept = calls.find((c) => c.path === '/api/act-invites/accept');
  expect(JSON.parse(String(accept?.body))).toEqual({ token: 'tok123' });
});

test('a closed or unknown invite link says so instead of offering Accept', async ({ page }) => {
  await mockApi(page, {
    '/api/act-invites/preview': {
      body: {
        invite: {
          id: 'i4',
          actId: 'a',
          actName: 'The Night Owls',
          inviterName: 'Olive Owner',
          roleName: 'Keys',
          status: 'expired',
          expiresAt: soon,
          createdAt: soon,
        },
      },
    },
  });
  await page.goto('/invites/old');
  await expect(page.getByText('This invite has expired')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to answer' })).toHaveCount(0);

  await page.unroute('**/api/**');
  await mockApi(page, {
    '/api/act-invites/preview': {
      status: 404,
      body: { error: "This invite link isn't valid.", code: 'INVITE_NOT_FOUND' },
    },
  });
  await page.goto('/invites/nope');
  await expect(page.getByRole('heading', { name: "This invite link isn't valid" })).toBeVisible();
});
