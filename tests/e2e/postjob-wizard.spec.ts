import { expect, test, type Page, type Route } from '@playwright/test';

// The three-step post-opportunity wizard: the plan line and held-back submit (J-01), drafts offered
// on reopen and prefill from the profile (J-13), and edits to a live listing (J-05).
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const job = {
  id: 'job-live',
  employer_id: 'qa-employer',
  title: 'Tour drummer',
  company: 'QA Employer',
  location: 'Mumbai',
  kind: 'Contract',
  type: 'Contract',
  genre: 'Rock',
  description: 'Drive a six-week run of club shows across western India with a four-piece band, kit provided.',
  requirements: '',
  status: 'published',
  opportunity_kind: 'tour',
  function_area: 'Performance',
  workplace: 'travel',
  compensation_min: 20000,
  compensation_max: 30000,
  compensation_period: 'show',
  currency: 'INR',
  paid: true,
  skills: [],
  languages: [],
  screeningQuestions: [],
  slots: 1,
};

async function mock(
  page: Page,
  options: {
    user?: Record<string, unknown>;
    limits?: unknown;
    jobs?: unknown[];
    job?: unknown;
    identities?: unknown[];
    savedPostedAs?: string;
  } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-token'));
  if (options.savedPostedAs !== undefined)
    await page.addInitScript(
      (value) => localStorage.setItem('musilynk:post-job:posted-as', value),
      options.savedPostedAs,
    );
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      /* no body */
    }
    calls.push({ method: request.method(), path, body });
    if (path === '/me') return json(route, { user: { ...employer, ...options.user } });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/jobs/limits') return json(route, options.limits ?? {});
    if (path === '/employer/jobs' && request.method() === 'GET') return json(route, { jobs: options.jobs ?? [] });
    if (path === '/me/identities') return json(route, { identities: options.identities ?? [] });
    if (path === '/jobs/job-live') return json(route, { job: options.job ?? job });
    if (path === '/jobs' && request.method() === 'POST') return json(route, { id: 'job-new', status: 'draft' }, 201);
    return json(route, { ok: true });
  });
  return calls;
}

test('a full plan is shown before the first field, and holds back only the submit', async ({ page }) => {
  await mock(page, { limits: { activeAllowed: 1, activeUsed: 1, plan: 'free', planName: 'Free' } });
  await page.goto('/employer/post-job');
  await expect(page.getByTestId('plan-line')).toHaveText(/Free plan: 1 of 1 active\s*— upgrade to post more\./);
  await expect(page.getByTestId('plan-line').getByRole('link', { name: 'See plans' })).toHaveAttribute(
    'href',
    '/employer/billing',
  );

  await page.getByLabel('Title').fill('Session drummer');
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await expect(page.getByTestId('limit-note')).toContainText('You can still save it as a draft.');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});

test('a plan with room shows its usage and leaves the submit enabled', async ({ page }) => {
  await mock(page, { limits: { activeAllowed: 10, activeUsed: 3, plan: 'pro', planName: 'Pro' } });
  await page.goto('/employer/post-job');
  await expect(page.getByTestId('plan-line')).toHaveText('Pro plan: 3 of 10 active');
  await page.getByLabel('Title').fill('Session drummer');
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
});

test('every step change saves a draft, and an earlier draft is offered on reopen', async ({ page }) => {
  const calls = await mock(page, { jobs: [{ ...job, id: 'job-draft', status: 'draft', title: 'Half-written gig' }] });
  await page.goto('/employer/post-job');
  const offer = page.getByTestId('draft-offer');
  await expect(offer).toContainText('Half-written gig');

  await offer.getByRole('button', { name: 'Start a new one' }).click();
  await expect(offer).toHaveCount(0);
  await page.getByLabel('Title').fill('Wedding band');
  await page.getByRole('combobox', { name: 'Location' }).fill('Pune');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();
  // "Start a new one" saves into the old draft's slot: one draft at a time, none added beside it.
  // One save per step change (Pay & dates, Screen & review), both into that slot.
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH').length).toBe(2);
  expect(calls.filter((c) => c.method === 'POST' && c.path === '/jobs')).toHaveLength(0);
  const saved = calls.filter((c) => c.method === 'PATCH');
  expect(saved.every((c) => c.path === '/employer/jobs/job-draft')).toBe(true);
  expect(saved[0].body).toMatchObject({ title: 'Wedding band', location: 'Pune' });

  await page.goto('/employer/post-job');
  await page.getByTestId('draft-offer').getByRole('button', { name: 'Continue draft' }).click();
  await expect(page).toHaveURL(/\/employer\/post-job\?edit=job-draft$/);
});

test('the city and the posting-as page come from the profile', async ({ page }) => {
  await mock(page, {
    user: { location: 'Pune', companyName: 'Bright Sound Studio' },
    identities: [
      { type: 'organization', id: 'org-0', name: 'Other Label', key: 'organization:org-0' },
      { type: 'organization', id: 'org-1', name: 'Bright Sound Studio', key: 'organization:org-1' },
    ],
  });
  await page.goto('/employer/post-job');
  await expect(page.getByRole('combobox', { name: 'Location' })).toHaveValue('Pune');
  await expect(page.getByLabel('Posting as')).toHaveText(/Bright Sound Studio/);
});

test('choosing not to disclose the pay hides the amounts and warns about fewer applicants', async ({ page }) => {
  const calls = await mock(page, { limits: { activeAllowed: 10, activeUsed: 0, plan: 'pro', planName: 'Pro' } });
  await page.goto('/employer/post-job');
  await page.getByLabel('Title').fill('Session drummer');
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  // The warning is about hiding the pay, so the untouched "Show the pay" choice does not carry it.
  await expect(page.getByText('Opportunities that don’t show the pay get fewer applicants.')).toHaveCount(0);
  await page.getByLabel('Not disclosed').check();
  await expect(page.getByText('Opportunities that don’t show the pay get fewer applicants.')).toBeVisible();
  await expect(page.getByLabel('Minimum pay')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();
  await page
    .getByLabel(/^Description/)
    .fill('We are recording a Hindi indie EP in Andheri and need a session drummer for three days of tracking.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(/\/employer$/);
  const submitted = calls.filter((c) => c.method === 'PATCH').at(-1);
  expect(submitted?.body).toMatchObject({
    status: 'pending',
    paid: true,
    compensationMin: null,
    compensationMax: null,
  });
});

test('pay edits on a live listing say nothing about review; title edits warn', async ({ page }) => {
  const calls = await mock(page, { limits: { activeAllowed: 1, activeUsed: 1, plan: 'free', planName: 'Free' } });
  await page.goto('/employer/post-job?edit=job-live');
  await expect(page.getByRole('heading', { name: 'Tour drummer', level: 1 })).toBeVisible();
  await page
    .getByRole('button', { name: /Pay & dates/ })
    .first()
    .click();
  await page.getByLabel('Minimum pay').fill('25000');
  await page
    .getByRole('button', { name: /Screen & review/ })
    .first()
    .click();
  await expect(page.getByText('send the opportunity back to review')).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeEnabled();

  await page
    .getByRole('button', { name: /What & where/ })
    .first()
    .click();
  await page.getByLabel('Title').fill('Tour drummer (six weeks)');
  await page
    .getByRole('button', { name: /Screen & review/ })
    .first()
    .click();
  await expect(
    page.getByText('Changes to the title, description or requirements send the opportunity back to review.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save & resubmit for review' })).toBeVisible();

  await page
    .getByRole('button', { name: /What & where/ })
    .first()
    .click();
  await page.getByLabel('Title').fill('Tour drummer');
  await page
    .getByRole('button', { name: /Screen & review/ })
    .first()
    .click();
  await save.click();
  await expect(page).toHaveURL(/\/employer$/);
  const patch = calls.filter((c) => c.method === 'PATCH' && c.path === '/employer/jobs/job-live').at(-1);
  expect(patch?.body).toMatchObject({ compensationMin: '25000', title: 'Tour drummer' });
  expect(patch?.body).not.toHaveProperty('status');
});
