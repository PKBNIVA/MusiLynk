import { expect, test, type Page, type Route } from '@playwright/test';

// B7 hirer flows against local API fixtures: the musician-level quote (A-09), the enquiry limit shown
// before the form (J-25), Ask for changes with a message, the deposit and trial states when payments
// are off (A-10, A-11), choosing an urgent responder (J-03), the submitted card and the double-click
// guard on Submit for review (J-12, A-16), the owner's view of an opportunity, and one thread per
// person in Messages (J-19). The real endpoints are covered by backend/test/integration/hirer_flows_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const hirer = {
  id: 'qa-hirer',
  name: 'QA Hirer',
  email: 'hirer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type Call = { method: string; path: string; body: unknown };
type Handler = (path: string, method: string, body: unknown, route: Route) => Promise<boolean> | boolean;

async function mock(page: Page, handler: Handler, user: Record<string, unknown> = hirer) {
  const calls: Call[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      /* no body */
    }
    calls.push({ method: request.method(), path, body });
    if (path === '/me') return json(route, { user });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (await handler(path, request.method(), body, route)) return;
    return json(route, { ok: true });
  });
  return calls;
}

test.describe('booking enquiries', () => {
  test('a quote asked of a musician who fronts no act goes out as a musician enquiry', async ({ page }) => {
    const calls = await mock(page, (path, method, _body, route) => {
      if (path === '/acts') return (json(route, { acts: [], total: 0 }), true);
      if (path === '/public/talent/m1')
        return (
          json(route, { professional: { id: 'm1', name: 'Dev Drummer', location: 'Mumbai' }, portfolio: [] }),
          true
        );
      if (path === '/bookings/limits')
        return (json(route, { activeAllowed: 2, activeUsed: 0, plan: 'free', planName: 'Free' }), true);
      if (path === '/bookings' && method === 'POST') return (json(route, { id: 'b1' }, 201), true);
      return false;
    });
    await page.goto('/employer/book-talent?member=m1');
    const dialog = page.getByRole('dialog', { name: 'Request a quote from Dev Drummer' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('booking-limit')).toHaveText('Free plan: 0 of 2 active enquiries');
    await dialog.getByLabel('Event date').fill(futureDate(40));
    await dialog.getByRole('button', { name: 'Request quote' }).click();
    await expect(page.getByText('Booking enquiry sent')).toBeVisible();
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/bookings');
    expect(sent?.body).toMatchObject({ musicianId: 'm1', city: 'Mumbai', eventType: 'wedding' });
    expect(sent?.body).not.toHaveProperty('actId');
  });

  test('the enquiry limit is said before the form and holds the request buttons back', async ({ page }) => {
    await mock(page, (path, _method, _body, route) => {
      if (path === '/acts')
        return (
          json(route, {
            acts: [
              { id: 'a1', name: 'The Night Owls', status: 'active', act_type: 'band', owner_id: 'o1', members: [] },
            ],
            total: 1,
          }),
          true
        );
      if (path === '/bookings/limits')
        return (json(route, { activeAllowed: 2, activeUsed: 2, plan: 'free', planName: 'Free' }), true);
      return false;
    });
    await page.goto('/employer/book-talent');
    await expect(page.getByTestId('booking-limit')).toContainText('Free plan: 2 of 2 active enquiries');
    await expect(page.getByTestId('booking-limit').getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/employer/billing',
    );
    await expect(page.getByRole('button', { name: 'Request availability' })).toBeDisabled();
  });

  test('Ask for changes takes a message and sends it with the status change', async ({ page }) => {
    const quote = {
      id: 'q1',
      performanceFee: 40000,
      travelFee: 0,
      productionFee: 0,
      otherFee: 0,
      total: 40000,
      currency: 'INR',
      depositPercent: 50,
      validUntil: null,
      status: 'sent',
    };
    const calls = await mock(page, (path, method, _body, route) => {
      if (path === '/bookings' && method === 'GET')
        return (
          json(route, {
            bookings: [
              {
                id: 'b1',
                actName: 'The Night Owls',
                status: 'quoted',
                event_type: 'wedding',
                event_date: futureDate(40),
                city: 'Pune',
                requesterName: 'QA Hirer',
                isOwner: false,
                isRequester: true,
                latestQuote: quote,
                paymentCount: 0,
                depositPaid: false,
                currency: 'INR',
                allowedTransitions: ['accepted', 'negotiating', 'cancelled'],
              },
            ],
          }),
          true
        );
      if (path === '/bookings/b1/status')
        return (json(route, { ok: true, status: 'negotiating', conversationId: 'c9' }), true);
      return false;
    });
    await page.goto('/employer/bookings');
    await page.getByRole('button', { name: 'Ask for changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ask for changes' });
    await dialog.getByLabel('What should change?').fill('Can you do a 90 minute set?');
    await dialog.getByRole('button', { name: 'Ask for changes' }).click();
    await expect(page.getByText('Asked for a revised quote')).toBeVisible();
    const status = calls.find((c) => c.path === '/bookings/b1/status');
    expect(status?.body).toMatchObject({ status: 'negotiating', message: 'Can you do a 90 minute set?' });
  });
});

test.describe('payments are off', () => {
  test('the deposit button gives way to a plain explanation, not a raw error', async ({ page }) => {
    await mock(page, (path, method, _body, route) => {
      if (path === '/billing/subscription') return (json(route, { paymentMode: 'live' }), true);
      if (path === '/bookings' && method === 'GET')
        return (
          json(route, {
            bookings: [
              {
                id: 'b1',
                actName: 'The Night Owls',
                status: 'accepted',
                event_type: 'wedding',
                event_date: futureDate(40),
                city: 'Pune',
                requesterName: 'QA Hirer',
                isOwner: false,
                isRequester: true,
                latestQuote: {
                  id: 'q1',
                  performanceFee: 40000,
                  travelFee: 0,
                  productionFee: 0,
                  otherFee: 0,
                  total: 40000,
                  currency: 'INR',
                  depositPercent: 50,
                  status: 'accepted',
                  feeAmount: 0,
                  gstAmount: 0,
                  feePercent: 0,
                },
                paymentCount: 1,
                depositPaid: false,
                currency: 'INR',
                allowedTransitions: ['cancelled'],
              },
            ],
          }),
          true
        );
      if (path === '/bookings/b1/payments')
        return (
          json(route, { payments: [{ id: 'p1', kind: 'deposit', status: 'created', amount: 20000, currency: 'INR' }] }),
          true
        );
      if (path === '/bookings/b1/payment-order')
        return (
          json(route, { error: 'Online payment is not switched on yet.', code: 'PAYMENTS_UNAVAILABLE' }, 503),
          true
        );
      return false;
    });
    await page.goto('/employer/bookings');
    await page.getByRole('button', { name: /Resume deposit payment/ }).click();
    const note = page.getByTestId('deposit-unavailable');
    await expect(note).toContainText('Deposit payment is not open yet');
    await expect(note).toContainText('message The Night Owls');
    await expect(page.getByText('Live payments are not configured')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Resume deposit payment/ })).toHaveCount(0);
    await expect(note.getByRole('button', { name: 'Check again' })).toBeVisible();
  });

  test('paid plans are disabled with an explanation under the payments-unavailable banner', async ({ page }) => {
    await mock(page, (path, _method, _body, route) => {
      if (path === '/billing/plans')
        return (
          json(route, {
            plans: [
              {
                code: 'free',
                name: 'Free',
                monthly: 0,
                trialDays: 0,
                activePosts: 1,
                seats: 1,
                shortlist: 20,
                bookings: 2,
              },
              {
                code: 'pro',
                name: 'Pro',
                monthly: 2499,
                trialDays: 14,
                activePosts: 10,
                seats: 2,
                shortlist: 250,
                bookings: 20,
              },
            ],
          }),
          true
        );
      if (path === '/billing/subscription')
        return (
          json(route, {
            subscription: null,
            plan: { code: 'free', name: 'Free' },
            purchasedPlan: null,
            summary: null,
            history: [],
            testMode: false,
            paymentMode: 'disabled',
          }),
          true
        );
      return false;
    });
    await page.goto('/employer/billing');
    await expect(page.getByText('Payments unavailable.')).toBeVisible();
    await expect(page.getByTestId('plan-pro').getByRole('button', { name: 'Start free trial' })).toBeDisabled();
    await expect(page.getByTestId('plan-pro-unavailable')).toContainText('Paid plans open once billing is set up');
  });
});

test.describe('urgent requests', () => {
  const mine = {
    id: 'urg1',
    requester_id: 'qa-hirer',
    title: 'Drummer needed in Mumbai',
    role_name: 'Drummer',
    city: 'Mumbai',
    currency: 'INR',
    status: 'open',
    start_at: new Date(Date.now() + 86_400_000).toISOString(),
    budget_min: 5000,
    budget_max: 10000,
    requesterName: 'QA Hirer',
    requesterVerified: false,
    myResponse: false,
    responseCount: 1,
  };

  test('the hirer messages a responder or books them, and the open requests sit on their own tab', async ({ page }) => {
    const scopes: string[] = [];
    const calls = await mock(page, (path, method, _body, route) => {
      if (path === '/urgent-requests' && method === 'GET') {
        const scope = new URL(route.request().url()).searchParams.get('scope') || '';
        scopes.push(scope);
        return (
          json(route, {
            requests: scope === 'mine' ? [mine] : [],
            scope,
            page: 1,
            perPage: 20,
            total: scope === 'mine' ? 1 : 0,
            hasMore: false,
          }),
          true
        );
      }
      if (path === '/urgent-requests/urg1/responses')
        return (
          json(route, {
            responses: [
              { user_id: 'm1', name: 'Dev Drummer', headline: 'Drummer', message: 'Free all evening', rate: 8000 },
            ],
          }),
          true
        );
      if (path === '/conversations' && method === 'POST')
        return (json(route, { id: 'c1', conversation: { id: 'c1' } }, 201), true);
      if (path === '/urgent-requests/urg1/accept') return (json(route, { ok: true, conversationId: 'c1' }), true);
      return false;
    });
    await page.goto('/employer/urgent');
    await expect(page.getByRole('tab', { name: 'My requests' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Drummer needed in Mumbai')).toBeVisible();
    await page.getByRole('button', { name: /Responses/ }).click();
    await expect(page.getByText('Rate: ₹8,000')).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Book Dev Drummer' }).click();
    await expect(page.getByText('Dev Drummer is booked')).toBeVisible();
    expect(calls.find((c) => c.path === '/urgent-requests/urg1/accept')?.body).toEqual({ userId: 'm1' });
    await page.getByRole('tab', { name: 'Browse open requests' }).click();
    await expect.poll(() => scopes).toContain('browse');
  });

  test('the post dialog keeps the 2-hour promise under the buttons', async ({ page }) => {
    await mock(page, (path, method, _body, route) => {
      if (path === '/urgent-requests' && method === 'GET')
        return (json(route, { requests: [], total: 0, hasMore: false }), true);
      return false;
    });
    await page.goto('/employer/urgent');
    await page.getByRole('button', { name: 'Post urgent need' }).click();
    const dialog = page.getByRole('dialog');
    const note = dialog.getByTestId('dialog-footer-note');
    await expect(note).toContainText('within 2 hours');
    const submit = await dialog.getByRole('button', { name: 'Publish request' }).boundingBox();
    const noteBox = await note.boundingBox();
    expect(noteBox!.y).toBeGreaterThan(submit!.y);
  });

  test('a musician is offered only the requests that fit, a page at a time', async ({ page }) => {
    const musician = { ...hirer, id: 'qa-musician', role: 'jobseeker', name: 'Ready Musician' };
    const urls: string[] = [];
    await mock(
      page,
      (path, method, _body, route) => {
        if (path === '/urgent-requests' && method === 'GET') {
          urls.push(route.request().url());
          const pageNo = Number(new URL(route.request().url()).searchParams.get('page') || 1);
          const rows = Array.from({ length: pageNo === 1 ? 20 : 5 }, (_, i) => ({
            ...mine,
            id: `u${pageNo}-${i}`,
            requester_id: 'other',
            title: `Bassist needed ${pageNo}-${i}`,
            responseCount: 0,
          }));
          return (
            json(route, {
              requests: rows,
              scope: 'matches',
              page: pageNo,
              perPage: 20,
              total: 25,
              hasMore: pageNo === 1,
            }),
            true
          );
        }
        return false;
      },
      musician,
    );
    await page.goto('/jobseeker/urgent');
    await expect(page.getByRole('tab', { name: 'Matches for you' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Showing 20 of 25')).toBeVisible();
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByText('Bassist needed 2-4')).toBeVisible();
    expect(urls.some((u) => u.includes('scope=matches') && u.includes('page=2'))).toBe(true);
  });
});

test.describe('posting and viewing an opportunity', () => {
  const fillFirstSteps = async (page: Page) => {
    await page.getByLabel('Title').fill('Session drummer');
    await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
    await page.getByRole('combobox', { name: 'Location' }).press('Enter');
    await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
    await page.getByRole('button', { name: 'Next: Screen & review' }).click();
    await page
      .getByLabel('Description')
      .fill('A day of recording in Mumbai, tracking drums for an EP release this winter. Kit provided.');
  };

  test('a double-click on Submit for review sends one request and shows what happens next', async ({ page }) => {
    const calls = await mock(page, async (path, method, _body, route) => {
      if (path === '/jobs/limits') return (json(route, {}), true);
      if (path === '/employer/jobs' && method === 'GET') return (json(route, { jobs: [] }), true);
      // Moving between steps saves a draft; the submission itself is then an update of that draft.
      if (path === '/jobs' && method === 'POST') return (json(route, { id: 'job-new', status: 'draft' }, 201), true);
      if (path === '/employer/jobs/job-new' && method === 'PATCH') {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return (json(route, { ok: true, job: { id: 'job-new', status: 'pending' } }), true);
      }
      return false;
    });
    await page.goto('/employer/post-job');
    await fillFirstSteps(page);
    await page.getByRole('button', { name: 'Submit for review' }).dblclick();
    const card = page.getByTestId('submitted-card');
    await expect(card).toContainText('What happens next');
    await expect(card).toContainText('within 24 hours');
    const submissions = calls.filter(
      (c) =>
        c.method === 'PATCH' &&
        c.path === '/employer/jobs/job-new' &&
        (c.body as { status?: string })?.status === 'pending',
    );
    expect(submissions).toHaveLength(1);
    await expect(card.getByRole('link', { name: 'View my opportunity' })).toHaveAttribute(
      'href',
      '/employer/jobs/job-new',
    );
  });

  test('starting a new one reuses the old draft instead of adding another', async ({ page }) => {
    const calls = await mock(page, (path, method, _body, route) => {
      if (path === '/jobs/limits') return (json(route, {}), true);
      if (path === '/employer/jobs' && method === 'GET')
        return (
          json(route, {
            jobs: [{ id: 'job-draft', status: 'draft', title: 'Half-written gig', allowedNextStatuses: [] }],
          }),
          true
        );
      return false;
    });
    await page.goto('/employer/post-job');
    await page.getByTestId('draft-offer').getByRole('button', { name: 'Start a new one' }).click();
    await page.getByLabel('Title').fill('Wedding band');
    await page.getByRole('combobox', { name: 'Location' }).fill('Pune');
    await page.getByRole('combobox', { name: 'Location' }).press('Enter');
    await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/jobs')).toHaveLength(0);
    expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/employer/jobs/job-draft');
  });

  test('the owner sees status, applicants and actions instead of the apply panel', async ({ page }) => {
    await mock(page, (path, method, _body, route) => {
      if (path === '/jobs/job1')
        return (
          json(route, {
            job: {
              id: 'job1',
              employer_id: 'qa-hirer',
              title: 'Tour drummer',
              company: 'QA Hirer',
              location: 'Mumbai',
              kind: 'Contract',
              type: 'Contract',
              genre: 'Rock',
              description:
                'Drive a six-week run of club shows across western India with a four-piece band, kit provided.',
              status: 'pending',
              opportunity_kind: 'tour',
              workplace: 'onsite',
              currency: 'INR',
              skills: [],
              languages: [],
              screeningQuestions: [],
              slots: 1,
              applicationsCount: 3,
            },
          }),
          true
        );
      if (path === '/jobs' && method === 'POST') return (json(route, { id: 'job2', status: 'draft' }, 201), true);
      return false;
    });
    await page.goto('/employer/jobs/job1');
    const panel = page.getByTestId('owner-panel');
    await expect(panel.getByTestId('owner-status')).toHaveText('In review');
    await expect(panel).toContainText('We review every listing within 24 hours');
    await expect(panel.getByRole('link', { name: '3 applicants' })).toHaveAttribute(
      'href',
      /\/employer\/applications\?jobId=job1/,
    );
    await expect(panel.getByRole('link', { name: 'Edit' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply now' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/post-job\?edit=job2/);
  });
});

test.describe('applicants and comparing', () => {
  test('with no applicants the page says so and offers Share on a live opportunity', async ({ page }) => {
    await mock(page, (path, _method, _body, route) => {
      if (path === '/employer/applications') return (json(route, { applications: [] }), true);
      if (path === '/employer/jobs')
        return (json(route, { jobs: [{ id: 'job1', title: 'Tour drummer', status: 'published' }] }), true);
      return false;
    });
    await page.goto('/employer/applications');
    await expect(page.getByRole('heading', { name: 'No applicants yet' })).toBeVisible();
    await expect(page.getByText('Most listings get their first applicant within 48 hours')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share this opportunity' })).toBeVisible();
  });

  test('an applicant links to the public profile', async ({ page }) => {
    await mock(page, (path, _method, _body, route) => {
      if (path === '/employer/applications')
        return (
          json(route, {
            applications: [
              {
                id: 'app1',
                jobId: 'job1',
                jobTitle: 'Tour drummer',
                candidateId: 'm1',
                candidateName: 'Dev Drummer',
                status: 'Applied',
                allowedNextStatuses: ['Shortlisted'],
                screeningAnswers: [],
              },
            ],
          }),
          true
        );
      return false;
    });
    await page.goto('/employer/applications');
    await expect(page.getByRole('link', { name: 'Dev Drummer' })).toHaveAttribute('href', '/professionals/m1');
  });

  test('compare columns have Message, Shortlist and Remove, and each tag appears once', async ({ page }) => {
    const person = (id: string, name: string, shortlisted: boolean) => ({
      id,
      name,
      headline: 'Drummer',
      location: 'Mumbai',
      roles: ['Drummer'],
      instruments: ['drummer', 'Tabla'],
      skills: ['Tabla'],
      verified: false,
      shortlisted,
      portfolio: [],
      availability: [],
    });
    const calls = await mock(page, (path, method, _body, route) => {
      if (path === '/candidates/compare/list')
        return (
          json(route, {
            // Like the API, only the people asked for come back.
            professionals: [
              person('m1', 'Dev Drummer', false),
              person('m2', 'Sia Singer', true),
              person('m3', 'Raj Tabla', false),
            ].filter((p) => (new URL(route.request().url()).searchParams.get('ids') || '').split(',').includes(p.id)),
          }),
          true
        );
      if (path === '/shortlists/m1') return (json(route, { ok: true }, method === 'POST' ? 201 : 200), true);
      if (path === '/conversations' && method === 'POST')
        return (json(route, { id: 'c1', conversation: { id: 'c1' } }, 201), true);
      return false;
    });
    await page.goto('/employer/compare?ids=m1,m2,m3');
    const first = page.getByTestId('compare-card').first();
    await expect(first.getByText('Tabla', { exact: true })).toHaveCount(1);
    await expect(first.getByText('Drummer', { exact: true })).toHaveCount(2); // headline + one tag
    await first.getByRole('button', { name: 'Shortlist' }).click();
    await expect(page.getByText('Added to talent shortlist')).toBeVisible();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/shortlists/m1')).toBe(true);
    await page.getByRole('button', { name: 'Remove Raj Tabla from the comparison' }).click();
    await expect(page).toHaveURL(/ids=m1%2Cm2$/);
    await expect(page.getByRole('heading', { name: 'Raj Tabla' })).toHaveCount(0);
  });
});

test.describe('messages', () => {
  test('threads made per opportunity before the one-per-person rule are grouped under the person', async ({ page }) => {
    const row = (id: string, jobTitle: string | null, unread: number) => ({
      id,
      counterpartId: 'm1',
      counterpartName: 'Dev Drummer',
      viewerSide: 'employer',
      jobTitle,
      lastMessage: 'hello',
      unreadCount: unread,
    });
    await mock(page, (path, _method, _body, route) => {
      if (path === '/conversations')
        return (
          json(route, { conversations: [row('c2', 'Studio session', 1), row('c1', 'Wedding drummer', 2)] }),
          true
        );
      if (/^\/conversations\/[^/]+\/messages$/.test(path))
        return (json(route, { messages: [], truncated: false, limit: 200 }), true);
      return false;
    });
    await page.goto('/employer/messages?c=c1');
    await expect(page.getByTestId('conversation-name')).toHaveCount(1);
    const context = page.getByTestId('thread-context');
    await expect(context.getByRole('button', { name: 'Wedding drummer' })).toHaveAttribute('aria-pressed', 'true');
    await context.getByRole('button', { name: 'Studio session' }).click();
    await expect(context.getByRole('button', { name: 'Studio session' })).toHaveAttribute('aria-pressed', 'true');
  });
});
