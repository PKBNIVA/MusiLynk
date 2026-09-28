import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow } from './qa-helpers';
import { mockApi } from './mock-api';

// Mocked-API regressions for the admin console on the admin site (moved from public-admin-hardening.spec.ts).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'admin-1',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const adminFixtures = () => ({
  '/api/admin/stats': { body: { stats: { users: 2, liveJobs: 1, pendingJobs: 1, openReports: 1 } } },
  '/api/admin/users': {
    body: {
      users: [
        {
          id: 'u-1',
          name: 'Asha Rao',
          email: 'asha@example.invalid',
          role: 'jobseeker',
          status: 'active',
          createdAt: '2026-09-01T00:00:00Z',
        },
        {
          id: 'admin-1',
          name: 'QA Admin',
          email: 'admin@example.invalid',
          role: 'admin',
          status: 'active',
          createdAt: '2026-09-01T00:00:00Z',
        },
      ],
    },
  },
  '/api/admin/jobs': {
    body: {
      jobs: [
        {
          id: 'job-1',
          title: 'Session Bassist',
          company: 'QA Studio',
          status: 'pending',
          opportunity_kind: 'session',
          description: 'Studio session.',
        },
      ],
    },
  },
  '/api/admin/reviews': { body: { reviews: [] } },
  '/api/admin/verifications': { body: { requests: [] } },
  '/api/admin/reports': {
    body: {
      reports: [
        {
          id: 'rep-1',
          status: 'open',
          entity_type: 'Job',
          entity_id: 'job-1',
          reason: 'Scam',
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    },
  },
  '/api/admin/audit': { body: { logs: [] } },
  '/api/admin/subscriptions': { body: { subscriptions: [] } },
  '/api/admin/bookings': { body: { bookings: [] } },
  '/api/admin/billing-attempts': {
    body: {
      attempts: [
        {
          id: 'bill-1',
          operation: 'subscription_create',
          provider: 'razorpay',
          state: 'ambiguous',
          provider_resource_id: 'sub_1',
          email: 'studio@example.invalid',
          created_at: '2026-09-01T00:00:00Z',
        },
        {
          id: 'bill-2',
          operation: 'subscription_create',
          provider: 'razorpay',
          state: 'pending',
          provider_resource_id: null,
          email: 'studio@example.invalid',
          created_at: '2026-09-01T00:00:00Z',
        },
      ],
    },
  },
  '/api/admin/billing-events': {
    body: {
      events: [
        {
          id: 'be-1',
          eventType: 'payment.captured',
          processingResult: 'applied',
          email: 'studio@example.invalid',
          paymentId: 'pay_1',
          amount: 250000,
          currency: 'INR',
          createdAt: '2026-09-01T00:00:00Z',
        },
      ],
      nextBefore: null,
    },
  },
});

test.describe('admin console', () => {
  test('one failing endpoint only blanks its own panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mockApi(
      page,
      { ...adminFixtures(), '/api/admin/reports': { status: 500, body: { error: 'Reports store offline' } } },
      admin,
    );
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
    await expect(page.getByText('1 of 11 panels could not load')).toBeVisible();
    await expect(page.getByText('Session Bassist')).toBeVisible();
    await page.getByRole('tab', { name: /Reports/ }).click();
    await expect(page.getByText('This panel could not load: Reports store offline')).toBeVisible();
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page.getByText('asha@example.invalid', { exact: false })).toBeVisible();
    await expect(page).toHaveTitle(/Admin/);
    expect(errors).toEqual([]);
  });

  test('rejecting an opportunity uses an in-page dialog and sends the reason', async ({ page }) => {
    let nativeDialog = false;
    page.on('dialog', (dialog) => {
      nativeDialog = true;
      void dialog.dismiss();
    });
    const calls = await mockApi(
      page,
      { ...adminFixtures(), 'PATCH /api/admin/jobs/job-1': { body: { ok: true } } },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Reject' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Reject opportunity' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill('Please add the fee range.');
    await confirm.click();
    await expect(dialog).toBeHidden();
    const patch = calls.find((call) => call.method === 'PATCH' && call.path === '/api/admin/jobs/job-1');
    expect(patch?.body).toEqual({ status: 'rejected', note: 'Please add the fee range.' });
    expect(nativeDialog).toBe(false);
  });

  test('suspending asks for confirmation and grant-plan validates days', async ({ page }) => {
    const calls = await mockApi(
      page,
      {
        ...adminFixtures(),
        'PATCH /api/admin/users/u-1': { body: { ok: true } },
        'POST /api/admin/users/u-1/grant-plan': { status: 201, body: { id: 'sub-1' } },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Users' }).click();
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByRole('dialog')).toContainText('signed out everywhere');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

    await page.getByRole('button', { name: 'Grant plan' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Plan').selectOption('studio');
    await dialog.getByLabel('Days').fill('0');
    await expect(dialog.getByRole('button', { name: 'Grant plan' })).toBeDisabled();
    await dialog.getByLabel('Days').fill('45');
    await dialog.getByRole('button', { name: 'Grant plan' }).click();
    await expect(dialog).toBeHidden();
    expect(calls.find((call) => call.path === '/api/admin/users/u-1/grant-plan')?.body).toEqual({
      planCode: 'studio',
      days: 45,
    });
    // Admin rows never offer plan or status changes.
    await expect(page.getByRole('button', { name: 'Grant plan' })).toHaveCount(1);
  });

  test('billing attempts can be reconciled from the commerce tab', async ({ page }) => {
    const calls = await mockApi(
      page,
      {
        ...adminFixtures(),
        'POST /api/admin/billing-attempts/bill-1/reconcile': {
          status: 503,
          body: { error: 'Live billing is not configured.' },
        },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Commerce' }).click();
    const buttons = page.getByRole('button', { name: 'Reconcile' });
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(1)).toBeDisabled();
    await expect(page.getByRole('region', { name: 'Billing events' })).toContainText('payment.captured');
    await expect(page.getByRole('region', { name: 'Billing events' })).toContainText('INR 2,500');
    await buttons.first().click();
    await expect(page.getByText('Live billing is not configured.')).toBeVisible();
    expect(
      calls.some((call) => call.method === 'POST' && call.path === '/api/admin/billing-attempts/bill-1/reconcile'),
    ).toBe(true);
  });

  test('sign-in doctor diagnoses an account and can revoke its sessions', async ({ page }) => {
    let active = 3;
    const calls = await mockApi(
      page,
      {
        ...adminFixtures(),
        '/api/admin/users/lookup': () => ({
          body: {
            email: 'asha@example.invalid',
            exists: true,
            emailProviderConfigured: false,
            user: {
              id: 'u-1',
              name: 'Asha Rao',
              role: 'jobseeker',
              status: 'suspended',
              emailVerified: false,
              profileComplete: true,
              passwordSet: true,
              createdAt: '2026-09-01T00:00:00Z',
              lastLoginAt: null,
            },
            sessions: { active, createdLast7Days: 4, cap: 10 },
            emailTokens: [
              { purpose: 'reset_password', createdAt: '2026-09-20T00:00:00Z', used: false, expired: false },
            ],
            recentAuthEvents: [{ action: 'auth.login', at: '2026-09-19T00:00:00Z', ip: '203.0.x.x' }],
            recentFailedLogins: { count: 2, windowMinutes: 15 },
            signInCodes: { outstanding: 1, lastRequestedAt: '2026-09-25T10:00:00Z', requestedLast24Hours: 1 },
            diagnosis: [
              { level: 'error', code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended.' },
              {
                level: 'error',
                code: 'EMAIL_UNDELIVERABLE',
                message: '1 password reset(s) requested but no email provider is configured.',
              },
            ],
          },
        }),
        'POST /api/admin/users/u-1/revoke-sessions': () => {
          const revoked = active;
          active = 0;
          return { body: { ok: true, revoked } };
        },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Sign-in doctor' }).click();
    await page.getByLabel('Account email').fill('  Asha@Example.invalid ');
    await page.getByRole('button', { name: 'Diagnose' }).click();
    const result = page.getByTestId('signin-doctor-result');
    await expect(result).toContainText('Account is suspended.');
    await expect(result).toContainText('no email provider is configured');
    await expect(result).toContainText('203.0.x.x');
    await expect(result).toContainText('1 outstanding');
    expect(calls.find((call) => call.path === '/api/admin/users/lookup')).toBeTruthy();
    const lookupUrl = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => n.includes('/admin/users/lookup')),
    );
    expect(lookupUrl).toContain('email=Asha%40Example.invalid');
    await page.getByRole('button', { name: /Sign out of all 3 session/ }).click();
    await expect(page.getByText('Signed out of 3 session(s)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign out of all/ })).toHaveCount(0);
  });

  test('sign-in doctor reports an unknown email', async ({ page }) => {
    await mockApi(
      page,
      {
        ...adminFixtures(),
        '/api/admin/users/lookup': {
          body: {
            email: 'nobody@example.invalid',
            exists: false,
            diagnosis: [{ level: 'error', code: 'NO_ACCOUNT', message: 'No account uses this email.' }],
          },
        },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Sign-in doctor' }).click();
    await page.getByLabel('Account email').fill('nobody@example.invalid');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('signin-doctor-result')).toContainText('No account uses this email.');
  });

  test('admin console fits a phone screen', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, adminFixtures(), admin);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Marketplace health' })).toBeVisible();
    await assertNoHorizontalOverflow(page, testInfo);
    await page.getByRole('tab', { name: 'Audit' }).click();
    await expect(page.getByText('No audit events yet.')).toBeVisible();
  });
});
