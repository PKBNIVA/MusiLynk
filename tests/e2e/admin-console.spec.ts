import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow } from './qa-helpers';
import { mockApi } from './mock-api';

// The public preview is the first local server (playwright.config.ts): QA_PORT_BASE.
const portBase = Number(process.env.QA_PORT_BASE || 4173);

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
      page: 1,
      perPage: 50,
      total: 2,
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
      page: 1,
      perPage: 100,
      total: 1,
    },
  },
  '/api/admin/reviews': { body: { reviews: [], page: 1, perPage: 100, total: 0 } },
  '/api/admin/verifications': { body: { requests: [], page: 1, perPage: 100, total: 0 } },
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
      page: 1,
      perPage: 100,
      total: 1,
    },
  },
  '/api/admin/audit': { body: { logs: [], page: 1, perPage: 100, total: 0 } },
  '/api/admin/subscriptions': { body: { subscriptions: [], page: 1, perPage: 100, total: 0 } },
  '/api/admin/bookings': { body: { bookings: [], page: 1, perPage: 100, total: 0 } },
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
      page: 1,
      perPage: 100,
      total: 2,
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
      total: 1,
      perPage: 200,
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
    await expect(page.getByText('1 of 10 panels could not load')).toBeVisible();
    await expect(page.getByText('Session Bassist')).toBeVisible();
    await page.getByRole('tab', { name: /Reports/ }).click();
    await expect(page.getByText('This panel could not load: Reports store offline')).toBeVisible();
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page.getByText('asha@example.invalid', { exact: false })).toBeVisible();
    await expect(page).toHaveTitle(/Admin/);
    expect(errors).toEqual([]);
  });

  test('tab badges show the server totals, not the rows on the loaded page', async ({ page }) => {
    await mockApi(
      page,
      {
        ...adminFixtures(),
        '/api/admin/stats': {
          body: { stats: { users: 2, pendingJobs: 621, verificationQueue: 303, pendingReviews: 17, openReports: 9 } },
        },
      },
      admin,
    );
    await page.goto('/admin');
    await expect(page.getByRole('tab', { name: 'Opportunity queue (621)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Verification (303)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reviews (17)' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reports (9)' })).toBeVisible();
  });

  test('the active tab lives in the URL and survives a reload', async ({ page }) => {
    await mockApi(page, adminFixtures(), admin);
    await page.goto('/admin');
    await page.getByRole('tab', { name: /Reports/ }).click();
    await expect(page).toHaveURL(/\/admin\?tab=reports$/);
    await page.reload();
    await expect(page.getByRole('tab', { name: /Reports/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /Opportunity queue/ }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin?tab=users');
    await expect(page.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/admin?tab=nonsense');
    await expect(page.getByRole('tab', { name: /Opportunity queue/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('the opportunity queue asks the server for one status and pages what it filters', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/jobs?')) urls.push(new URL(request.url()).search);
    });
    await mockApi(
      page,
      {
        ...adminFixtures(),
        '/api/admin/jobs': {
          body: {
            jobs: [
              { id: 'job-1', title: 'Session Bassist', company: 'QA Studio', status: 'pending', description: 'x' },
            ],
            page: 1,
            perPage: 1,
            total: 3,
          },
        },
      },
      admin,
    );
    await page.goto('/admin');
    await expect(page.getByText('Showing 1–1 of 3')).toBeVisible();
    expect(urls[0]).toContain('status=pending');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => urls.some((u) => u.includes('page=2') && u.includes('status=pending'))).toBe(true);
    await page.getByLabel('Status').click();
    await page.getByRole('option', { name: 'Published' }).click();
    await expect.poll(() => urls.some((u) => u.includes('page=1') && u.includes('status=published'))).toBe(true);
  });

  test('one long unbroken report text wraps instead of widening the console', async ({ page }, testInfo) => {
    const fixtures = adminFixtures();
    fixtures['/api/admin/reports'] = {
      body: {
        reports: [
          {
            id: 'rep-long',
            status: 'open',
            entity_type: 'Job',
            entity_id: 'job-1',
            reason: 'Scam',
            details: 'A'.repeat(40_000),
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
        page: 1,
        perPage: 100,
        total: 1,
      },
    } as never;
    await mockApi(page, fixtures, admin);
    await page.goto('/admin?tab=reports');
    const review = page.getByRole('button', { name: 'Review report: Scam' });
    await expect(review).toBeVisible();
    const box = await review.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    await assertNoHorizontalOverflow(page, testInfo);
  });

  test('a report links to the listing on the public site, absolutely, since the admin build has no public routes', async ({
    page,
  }) => {
    await mockApi(page, adminFixtures(), admin);
    await page.goto('/admin');
    await page.getByRole('tab', { name: /Reports/ }).click();
    const link = page.getByRole('link', { name: 'job-1' });
    await expect(link).toBeVisible();
    // VITE_PUBLIC_URL for the admin build under test is set to the public preview's own origin
    // (playwright.config.ts) — see src/app/lib/appTarget.ts's toPublicUrl.
    await expect(link).toHaveAttribute('href', `http://127.0.0.1:${portBase}/opportunities/job-1`);
    await expect(link).toHaveAttribute('target', '_blank');
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

  test('verification queue shows the evidence score and approves in one click with the suggested checks', async ({
    page,
  }) => {
    const request = (id: string, name: string, score: number, extra: Record<string, unknown> = {}) => ({
      id,
      user_id: `u-${id}`,
      kind: 'professional',
      status: 'pending',
      created_at: '2026-09-01T00:00:00Z',
      name,
      email: `${id}@example.invalid`,
      role: 'jobseeker',
      evidence_score: score,
      ...extra,
    });
    const calls = await mockApi(
      page,
      {
        ...adminFixtures(),
        '/api/admin/verifications': {
          body: {
            requests: [
              request('v-1', 'Rahul Drums', 82, {
                summary: 'Name matches YouTube channel.\n1 vouch from verified Priya S.',
                evidence_breakdown: {
                  identity: { score: 30, max: 30 },
                  links: { score: 20, max: 30 },
                  community: { score: 10, max: 20 },
                },
              }),
              request('v-2', 'Mid Person', 55, { flags: ['duplicate_links'] }),
              request('v-3', 'Low Person', 10),
              request('v-4', 'Auto Person', 90, {
                status: 'approved',
                auto_decision: 'auto_approved',
                audit_sample: true,
              }),
            ],
            page: 1,
            perPage: 100,
            total: 4,
          },
        },
        '/api/admin/verifications/stats': {
          body: {
            days7: { total: 8, autoApproved: 2, autoApprovalRate: 25, auditSample: 1 },
            days30: { total: 30, autoApproved: 9, autoApprovalRate: 30, auditSample: 3 },
          },
        },
        'PATCH /api/admin/verifications/v-1': { body: { ok: true } },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: /Verification/ }).click();
    await expect(page.getByLabel('Evidence score 82 out of 100')).toHaveAttribute('data-band', 'green');
    await expect(page.getByLabel('Evidence score 55 out of 100')).toHaveAttribute('data-band', 'amber');
    await expect(page.getByLabel('Evidence score 10 out of 100')).toHaveAttribute('data-band', 'grey');
    await expect(page.getByText('Duplicate links')).toBeVisible();
    await expect(page.getByText('1 vouch from verified Priya S.')).toBeVisible();
    await expect(page.getByTestId('verification-stats')).toContainText(
      '7 days: 2 of 8 auto-approved (25%), 1 in audit sample',
    );

    await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
    await expect
      .poll(() => calls.find((c) => c.method === 'PATCH' && c.path === '/api/admin/verifications/v-1')?.body)
      .toEqual({
        status: 'approved',
        checks: ['identity', 'work_links', 'credits'],
      });

    await page.getByRole('button', { name: /Audit sample/ }).click();
    await expect(page.getByText('Auto Person')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible();
    await expect(page.getByText('Mid Person')).toBeHidden();
  });

  test('users tab searches the server and pages through the rest instead of filtering only what loaded', async ({
    page,
  }) => {
    const older = {
      id: 'u-old',
      name: 'Professional Old Nine',
      email: 'professional-old-nine@example.invalid',
      role: 'jobseeker',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
    };
    const calls = await mockApi(
      page,
      {
        ...adminFixtures(),
        'GET /api/admin/users': (request) => {
          const url = new URL(request.url());
          const q = url.searchParams.get('q') || '';
          if (q.includes('professional-old-nine')) {
            return { body: { users: [older], page: 1, perPage: 50, total: 1 } };
          }
          return {
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
              ],
              page: 1,
              perPage: 50,
              total: 1005,
            },
          };
        },
      },
      admin,
    );
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page.getByText(/Showing 1.50 of 1,005/)).toBeVisible();
    await page.getByLabel('Search users').fill('professional-old-nine');
    await expect(page.getByText('professional-old-nine@example.invalid')).toBeVisible();
    await expect(page.getByText('Showing 1–1 of 1', { exact: false })).toBeVisible();
    const searchCall = calls.filter((c) => c.path === '/api/admin/users').at(-1);
    expect(searchCall?.method).toBe('GET');
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
    await dialog.getByRole('combobox', { name: 'Plan' }).click();
    await page.getByRole('option', { name: 'Studio' }).click();
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

  test('sign-in doctor: diagnosing with an empty email shows an inline error instead of doing nothing', async ({
    page,
  }) => {
    const calls = await mockApi(page, adminFixtures(), admin);
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Sign-in doctor' }).click();
    await page.getByRole('button', { name: 'Diagnose' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter an email to diagnose.' })).toBeVisible();
    expect(calls.some((call) => call.path === '/api/admin/users/lookup')).toBe(false);
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
