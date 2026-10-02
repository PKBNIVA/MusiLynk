import { expect, test, type Page, type Request } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Search and discovery (SRCH-01, 04, 05, 07, 08, 09, 11, 13) against a mocked API: URL state with
// real history entries, did-you-mean notices and empty states, removable role filter, act search
// and filters, grouped global results with "See all", paging and consistent job cards.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

type Role = 'jobseeker' | 'employer' | null;
type Handler = (url: URL, request: Request) => unknown;

const job = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `job-${n}`,
  title: `Violinist for a wedding ${n}`,
  company: 'MusiLynk Weddings',
  location: 'Goa',
  workplace: 'hybrid',
  function_area: 'Performance',
  type: 'Contract',
  kind: 'Contract',
  opportunity_kind: 'gig',
  genre: 'Classical',
  currency: 'INR',
  compensation_min: 15000,
  compensation_max: 35000,
  application_deadline: '2026-11-11T12:00:00.000Z',
  skills: ['Violin'],
  applicationsCount: 3,
  employerVerified: true,
  saved: false,
  ...extra,
});
const pro = (n: number) => ({
  id: `pro-${n}`,
  name: `Asha ${n}`,
  role: 'jobseeker',
  headline: 'Vocalist · Bollywood',
  location: 'Mumbai',
  skills: ['Vocals'],
  genres: [],
  instruments: [],
  languages: [],
  credits: [],
  openTo: [],
  roles: ['Vocalist'],
  gear: [],
  software: [],
});
const act = (n: number) => ({
  id: `act-${n}`,
  name: `Night Owls ${n}`,
  act_type: 'band',
  city: 'Pune',
  genres: ['Sufi'],
});

/** Mocks the API; `routes` maps a path suffix to a handler. Records every API request URL. */
async function mockApi(page: Page, role: Role, routes: Record<string, Handler>) {
  const calls: URL[] = [];
  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));
  if (role) {
    await page.addInitScript((r) => {
      localStorage.setItem('verse_access_token', 'qa-token');
      localStorage.setItem(`verse-tour-v2-${r}`, 'done');
    }, role);
  }
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/api/me')) {
      return role
        ? reply(200, {
            user: { id: 'me', name: 'QA', email: 'qa@example.invalid', role, status: 'active', profileComplete: true },
          })
        : reply(401, { error: 'Sign in' });
    }
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((path) => url.pathname.endsWith(path));
    if (key) return reply(200, routes[key](url, route.request()));
    if (url.pathname.endsWith('/api/taxonomy')) {
      return reply(200, {
        functionAreas: ['Performance', 'Music Production', 'Live Sound & Audio'],
        actTypes: ['band', 'duo', 'wedding-band'],
        talentRoles: [{ key: 'performer', label: 'Artists & performers' }],
      });
    }
    return reply(200, {});
  });
  return calls;
}

const apiCalls = (calls: URL[], path: string) => calls.filter((u) => u.pathname.endsWith(path));

test('public jobs: each filter is a history entry, so Back undoes one at a time (SRCH-09)', async ({ page }) => {
  const calls = await mockApi(page, null, { '/api/jobs': () => ({ jobs: [job(1)], nextCursor: null, total: 1 }) });
  await page.goto('/music-jobs');
  await expect(page.getByTestId('result-count')).toHaveText('1 opportunity');
  await page.getByRole('button', { name: 'Gigs' }).click();
  await expect(page).toHaveURL(/kind=gig/);
  await page.getByLabel('Search opportunities').fill('violinist');
  await page.getByLabel('Opportunity location').fill('Goa');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=violinist/);
  await expect.poll(() => apiCalls(calls, '/api/jobs').at(-1)?.searchParams.get('location')).toBe('Goa');

  await page.goBack();
  await expect(page).toHaveURL(/\/music-jobs\?kind=gig$/);
  await expect(page.getByLabel('Search opportunities')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Gigs' })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/\/music-jobs$/);
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => apiCalls(calls, '/api/jobs').at(-1)?.search).toBe('');
});

test('a corrected misspelling is announced and an empty search suggests the fix (SRCH-07)', async ({ page }) => {
  await mockApi(page, null, {
    '/api/jobs': (url) =>
      url.searchParams.get('q') === 'guitarst'
        ? {
            jobs: [job(1)],
            total: 1,
            nextCursor: null,
            matchMode: 'corrected',
            didYouMean: 'guitarist',
            interpretedAs: ['guitarist'],
          }
        : url.searchParams.get('q') === 'zzz'
          ? { jobs: [], total: 0, nextCursor: null, matchMode: 'all', didYouMean: 'jazz' }
          : { jobs: [job(2)], total: 1, nextCursor: null },
  });
  await page.goto('/music-jobs?q=guitarst');
  await expect(page.getByTestId('search-notice')).toHaveText(
    'Showing results for guitarist. Nothing matched “guitarst”.',
  );

  await page.goto('/music-jobs?q=zzz&kind=gig');
  const empty = page.getByTestId('no-results');
  await expect(empty.getByRole('heading', { name: 'No opportunities found for “zzz”' })).toBeVisible();
  await empty.getByRole('button', { name: 'jazz' }).click();
  await expect(page).toHaveURL(/q=jazz/);
  await expect(page).toHaveURL(/kind=gig/);
  await page.goto('/music-jobs?q=zzz&kind=gig');
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page).toHaveURL(/\/music-jobs$/);
});

test('a landing role link opens a hire page whose "browse all" link opens a labelled, removable role filter (SRCH-01)', async ({
  page,
}) => {
  const calls = await mockApi(page, null, {
    '/api/public/hire-pages/drummer/mumbai': () => ({
      role: { slug: 'drummer', label: 'Drummer' },
      city: { slug: 'mumbai', name: 'Mumbai' },
      counts: { professionals: 10, verified: 4, availableThisWeek: 2 },
      featured: [],
      relatedRoles: [],
      nearbyCities: [],
      indexable: true,
      ratesPath: '/rates/mumbai',
      faq: [{ question: 'Q', answer: 'A' }],
    }),
    '/api/public/talent': (url) => ({
      talent: url.searchParams.get('role') ? [pro(1)] : [pro(1), pro(2)],
      total: url.searchParams.get('role') ? 1 : 2,
      nextCursor: null,
      ...(url.searchParams.get('role') ? { role: { key: 'performer', label: 'Artists & performers' } } : {}),
    }),
  });
  // The landing page links role × city searches into a hire page, whose "browse all" link opens
  // the directory with the same role and city (the label comes from the API).
  await page.goto('/');
  await page.getByRole('link', { name: 'Hire a drummer in Mumbai' }).click();
  await expect(page).toHaveURL(/\/hire\/drummer\/mumbai$/);
  await page.getByRole('link', { name: 'Browse all drummers in Mumbai' }).click();
  await expect(page).toHaveURL(/\/music-professionals\?role=drummer/);
  const chip = page.getByTestId('role-filter');
  await expect(chip).toContainText('Showing: Artists & performers');
  await expect(page.getByTestId('result-count')).toHaveText('1 musician');
  await chip.getByRole('button', { name: 'Remove filter Artists & performers' }).click();
  await expect(page).not.toHaveURL(/role=/);
  await expect(page.getByTestId('result-count')).toHaveText('2 musicians');
  expect(apiCalls(calls, '/api/public/talent').at(-1)?.searchParams.get('role')).toBeNull();
});

test('the professional directory pages past the first 30 (SRCH-05)', async ({ page }) => {
  const all = Array.from({ length: 45 }, (_, i) => pro(i));
  await mockApi(page, null, {
    '/api/public/talent': (url) => {
      const start = Number(url.searchParams.get('cursor') || 0);
      return {
        talent: all.slice(start, start + 30),
        total: 45,
        nextCursor: start + 30 < 45 ? String(start + 30) : null,
      };
    },
  });
  await page.goto('/music-professionals');
  await expect(page.getByText('Showing 30 of 45 musicians')).toBeVisible();
  await page.getByRole('button', { name: 'Load more musicians' }).click();
  await expect(page.getByText('Showing 45 of 45 musicians')).toBeVisible();
  await expect(page.locator('[data-list-item="30"]')).toBeFocused();
});

test('signed-in job search keeps its filters in the URL (SRCH-06, SRCH-08)', async ({ page }) => {
  const calls = await mockApi(page, 'jobseeker', {
    '/api/jobs': () => ({ jobs: [job(1)], total: 1, nextCursor: null }),
  });
  await page.goto('/jobseeker/jobs');
  await page.getByRole('button', { name: 'Filters' }).click();
  const functions = page.getByLabel('Function');
  await functions.click();
  await expect(page.getByRole('option')).toHaveText([
    'All functions',
    'Performance',
    'Music Production',
    'Live Sound & Audio',
  ]);
  await page.getByRole('option', { name: 'Music Production' }).click();
  await expect(page).toHaveURL(/function=Music\+Production/);
  await expect.poll(() => apiCalls(calls, '/api/jobs').at(-1)?.searchParams.get('function')).toBe('Music Production');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Function')).toHaveText('Music Production');
  await page.goBack();
  await expect(page).toHaveURL(/\/jobseeker\/jobs$/);
  await expect.poll(() => apiCalls(calls, '/api/jobs').at(-1)?.searchParams.get('function')).toBeNull();
});

test('job cards show the same facts on public and signed-in lists (SRCH-13)', async ({ page }) => {
  await mockApi(page, 'jobseeker', { '/api/jobs': () => ({ jobs: [job(1)], total: 1, nextCursor: null }) });
  const cardFacts = ['Goa · Hybrid', 'Performance', 'Classical'];
  const facts = ['₹15,000–35,000', '3 applicants', 'Closes 11 Nov 2026 · in 44 days'];
  for (const path of ['/jobseeker/jobs', '/music-jobs']) {
    await page.goto(path);
    const card = page.getByTestId('job-card').first();
    await expect(card.locator('[data-glyph="gig"]')).toBeVisible();
    for (const fact of cardFacts) await expect(card).toContainText(fact);
    for (const fact of facts) await expect(card.getByTestId('job-facts')).toContainText(fact);
  }
});

test('candidate search keeps the query in the URL and pages results', async ({ page }) => {
  const all = Array.from({ length: 35 }, (_, i) => pro(i));
  const calls = await mockApi(page, 'employer', {
    '/api/candidates': (url) => {
      const start = Number(url.searchParams.get('cursor') || 0);
      return { candidates: all.slice(start, start + 30), total: 35, nextCursor: start ? null : '30' };
    },
    '/api/recent-activity': () => ({ items: [] }),
  });
  await page.goto('/employer/candidates');
  await page.getByLabel('Skill, credit, gear or software').fill('singer');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=singer/);
  await expect.poll(() => apiCalls(calls, '/api/candidates').at(-1)?.searchParams.get('q')).toBe('singer');
  await page.getByRole('button', { name: 'Load more musicians' }).click();
  await expect(page.getByText('Showing 35 of 35 musicians')).toBeVisible();
  expect(apiCalls(calls, '/api/candidates').at(-1)?.searchParams.get('q')).toBe('singer');
});

test('acts can be searched and filtered by city and type on /book-music (SRCH-11)', async ({ page }) => {
  const calls = await mockApi(page, null, {
    '/api/public/acts': (url) =>
      url.searchParams.get('q')
        ? { acts: [act(1)], total: 1, nextCursor: null }
        : { acts: [act(1), act(2)], total: 2, nextCursor: null },
  });
  await page.goto('/book-music');
  await expect(page.getByTestId('result-count')).toHaveText('2 acts');
  await page.getByLabel('Search acts').fill('wedding band');
  await page.getByLabel('City').fill('Goa');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await chooseOption(page.getByLabel('Act type'), 'Duo');
  await expect(page).toHaveURL(/q=wedding\+band/);
  await expect(page).toHaveURL(/type=duo/);
  const last = () => apiCalls(calls, '/api/public/acts').at(-1)?.searchParams;
  await expect.poll(() => last()?.get('type')).toBe('duo');
  expect(last()?.get('q')).toBe('wedding band');
  expect(last()?.get('city')).toBe('Goa');
  await expect(page.getByTestId('result-count')).toHaveText('1 act');
});

test('global search groups types with totals and "See all" opens a paged list (SRCH-04)', async ({ page }) => {
  const result = (type: string, n: number) => ({
    type,
    id: `${type}-${n}`,
    url: `/x/${n}`,
    title: `${type} ${n}`,
    subtitle: '',
    tags: [],
    demo: false,
  });
  const calls = await mockApi(page, null, {
    '/api/search': (url) =>
      url.searchParams.get('type') === 'jobs'
        ? {
            results: Array.from({ length: url.searchParams.get('cursor') ? 5 : 20 }, (_, i) =>
              result('jobs', i + (url.searchParams.get('cursor') ? 20 : 0)),
            ),
            interpretedAs: ['vocalist'],
            total: 25,
            totals: { jobs: 25 },
            nextCursor: url.searchParams.get('cursor') ? null : 'c20',
          }
        : {
            results: [result('jobs', 1), result('jobs', 2), result('acts', 1)],
            interpretedAs: ['vocalist', 'singer'],
            totals: { jobs: 25, talent: 0, acts: 1, samples: 0 },
            moreOf: { jobs: true, talent: false, acts: false, samples: false },
          },
  });
  await page.goto('/search?q=vocalist');
  await expect(page.getByTestId('group-jobs')).toContainText('Opportunities25');
  await expect(page.getByTestId('group-acts')).toContainText('Acts1');
  await expect(page.getByTestId('group-acts').getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'See all 25 opportunities' }).click();
  await expect(page).toHaveURL(/type=jobs/);
  await expect(page.getByText('Showing 20 of 25 opportunities')).toBeVisible();
  await page.getByRole('button', { name: 'Load more opportunities' }).click();
  await expect(page.getByText('Showing 25 of 25 opportunities')).toBeVisible();
  expect(apiCalls(calls, '/api/search').at(-1)?.searchParams.get('cursor')).toBe('c20');
  await page.goBack();
  await expect(page.getByTestId('group-jobs')).toBeVisible();
});
