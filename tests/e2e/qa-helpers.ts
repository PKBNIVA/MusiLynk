import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { Act, Job, PortfolioItem, Professional } from '../../src/app/lib/apiTypes';

export const publicRoutes = [
  ['Home', '/'],
  ['Pricing', '/pricing'],
  ['Intent hub', '/start'],
  ['Guide', '/guide'],
  ['Search', '/search'],
  ['Site map', '/sitemap'],
  ['Music jobs', '/music-jobs'],
  ['Musicians', '/music-professionals'],
  ['Book music', '/book-music'],
  ['About', '/about'],
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Safety', '/safety'],
  ['Cookies', '/cookies'],
  ['Refund policy', '/refund-policy'],
  ['Community guidelines', '/community-guidelines'],
  ['Accessibility', '/accessibility'],
  ['Contact', '/contact'],
  ['Forgot password', '/forgot-password'],
  ['Musician authentication', '/auth/jobseeker'],
  ['Hirer authentication', '/auth/employer'],
  ['Musician sign-up', '/join/musician'],
  ['Hirer sign-up', '/join/hiring'],
] as const;

export const accessibilityRoutes = [
  ['Home', '/'],
  ['Pricing', '/pricing'],
  ['Intent hub', '/start'],
  ['Music jobs', '/music-jobs'],
  ['Musicians', '/music-professionals'],
  ['Book music', '/book-music'],
  ['Guide', '/guide'],
  ['Search', '/search'],
  ['Site map', '/sitemap'],
  ['Photo credits', '/credits'],
  ['About', '/about'],
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Refund policy', '/refund-policy'],
  ['Accessibility statement', '/accessibility'],
  ['Contact', '/contact'],
  ['Verify email', '/verify-email'],
  ['Forgot password', '/forgot-password'],
  ['Not found', '/this-page-does-not-exist'],
  ['Musician authentication', '/auth/jobseeker'],
  ['Hirer authentication', '/auth/employer'],
  ['Musician sign-up', '/join/musician'],
  ['Hirer sign-up', '/join/hiring'],
] as const;

// Populated directory data. The mocked axe, overflow and cursor sweeps used to see only empty lists,
// so none of them ever looked at a real card; the live nightly run was the only place that did.
// These are typed with the interfaces the pages use, so a field the pages start to require fails the
// typecheck here instead of silently rendering nothing. They cover the card variants on purpose:
// rates, a verified and an unverified profile, audio and video samples (one with a thumbnail), a paid
// and an unpaid opportunity, an act with a confirmed lineup and one with a single member.
const svgThumb = (fill: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/></svg>`,
  )}`;

const profileLists = {
  skills: [],
  genres: [],
  instruments: [],
  languages: [],
  credits: [],
  openTo: [],
  roles: [],
  gear: [],
  software: [],
};

export const fixtureTalent: Professional[] = [
  {
    ...profileLists,
    id: 'qa-talent-1',
    name: 'Asha Kulkarni',
    role: 'jobseeker',
    headline: 'Session vocalist and playback singer',
    location: 'Mumbai',
    bio: 'Hindi and Marathi playback, jingles and live sets. Ten years in Mumbai studios.',
    roles: ['Singer', 'Vocalist'],
    genres: ['Bollywood', 'Ghazal', 'Indie'],
    instruments: ['Vocals'],
    languages: ['Hindi', 'Marathi', 'English'],
    credits: ['Coke Studio Bharat backing vocals', 'Two feature-film playback songs'],
    openTo: ['Session work', 'Weddings', 'Touring'],
    yearsExperience: 10,
    sessionRate: 8000,
    showRate: 25000,
    dayRate: 15000,
    currency: 'INR',
    availability: 'Weekends and evenings',
    verified: true,
    verification: { checks: ['Identity', 'Work samples', 'Reviews'], verifiedAt: '2026-08-01T10:00:00Z' },
    verificationTier: 'verified_pro',
    reviewsCount: 6,
    reviewsAverage: 4.8,
    responseTimeMinutes: 25,
    fastResponderBadge: true,
    demo: false,
  },
  {
    ...profileLists,
    id: 'qa-talent-2',
    name: 'Rohan Deshpande',
    role: 'jobseeker',
    headline: 'Tabla and percussion for shows and studio',
    location: 'Pune',
    roles: ['Tabla player', 'Percussionist'],
    genres: ['Hindustani', 'Fusion', 'Sufi'],
    instruments: ['Tabla', 'Cajon'],
    languages: ['Hindi', 'Marathi'],
    openTo: ['Studio session', 'Concerts'],
    yearsExperience: 7,
    sessionRate: 5000,
    showRate: 18000,
    currency: 'INR',
    verified: false,
    verification: null,
    verificationTier: null,
    reviewsCount: 0,
    reviewsAverage: null,
    responseTimeMinutes: null,
    demo: true,
  },
  {
    ...profileLists,
    id: 'qa-talent-3',
    name: 'Meera Iyer',
    role: 'jobseeker',
    headline: 'Live sound engineer for clubs and festivals',
    location: 'Bengaluru',
    roles: ['Sound engineer'],
    genres: ['Rock', 'Jazz'],
    instruments: ['DiGiCo SD9', 'Yamaha CL5'],
    languages: ['English', 'Tamil', 'Kannada'],
    openTo: ['Festival', 'Corporate event'],
    yearsExperience: 12,
    dayRate: 22000,
    hourlyRate: 3000,
    currency: 'INR',
    verified: true,
    verification: { checks: ['Identity'], verifiedAt: '2026-07-12T10:00:00Z' },
    verificationTier: 'verified',
    reviewsCount: 2,
    reviewsAverage: 4.5,
    responseTimeMinutes: 90,
    demo: false,
  },
];

export const fixtureSamples: Record<string, PortfolioItem[]> = {
  'qa-talent-1': [
    {
      id: 'qa-sample-1',
      userId: 'qa-talent-1',
      kind: 'audio',
      type: 'audio',
      title: 'Live in Bandra: Raat Baaki',
      url: 'https://cdn.example.test/qa/raat-baaki.mp3',
      creditedAs: 'Asha Kulkarni',
      thumbnailUrl: svgThumb('#7c3aed'),
      visibility: 'public',
      genres: ['Bollywood'],
      mediaMetadata: { contentType: 'audio/mpeg', byteSize: 3_400_000, filename: 'raat-baaki.mp3' },
      year: 2025,
      featured: true,
    },
  ],
  'qa-talent-2': [
    {
      id: 'qa-sample-2',
      userId: 'qa-talent-2',
      kind: 'youtube',
      type: 'youtube',
      title: 'Teental solo, Pune rehearsal room',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      visibility: 'public',
      genres: ['Hindustani'],
      year: 2024,
    },
  ],
  'qa-talent-3': [],
};

export const fixtureJobs: Job[] = [
  {
    id: 'qa-job-1',
    employer_id: 'qa-hirer-1',
    title: 'Wedding sangeet band, 4 hours',
    company: 'Shaadi Sound Co.',
    location: 'Mumbai',
    kind: 'gig',
    type: 'gig',
    opportunity_kind: 'gig',
    genre: 'Bollywood',
    function_area: 'Performance',
    workplace: 'on_site',
    salary: null,
    currency: 'INR',
    compensation_period: 'per_event',
    compensation_min: 40000,
    compensation_max: 60000,
    description:
      'Sangeet night for 300 guests at a Juhu venue. Bollywood and Punjabi sets, two 90-minute halves, sound provided.',
    requirements: 'Own instruments, black kurta dress code, arrive for a 5 pm soundcheck.',
    skills: ['Live performance'],
    languages: ['Hindi', 'Punjabi'],
    screening_questions: [],
    screeningQuestions: [],
    status: 'active',
    paid: true,
    featured: true,
    portfolio_required: true,
    portfolioRequired: true,
    published_at: '2026-09-20T08:00:00Z',
    application_deadline: '2026-10-25T00:00:00Z',
    employerName: 'Shaadi Sound Co.',
    employerVerified: true,
    demo: false,
    applicationsCount: 4,
    createdAt: '2026-09-20T08:00:00Z',
    updatedAt: '2026-09-20T08:00:00Z',
  },
  {
    id: 'qa-job-2',
    employer_id: 'qa-hirer-2',
    title: 'Session guitarist for an indie EP',
    company: 'Bandra Tape Studio',
    location: 'Mumbai',
    kind: 'session',
    type: 'session',
    opportunity_kind: 'session',
    genre: 'Indie',
    function_area: 'Recording & Studio',
    workplace: 'on_site',
    salary: null,
    currency: 'INR',
    compensation_period: 'per_day',
    compensation_min: 12000,
    compensation_max: null,
    description: 'Two days tracking acoustic and clean electric parts for a five-song EP. Charts will be shared.',
    skills: ['Guitar', 'Sight reading'],
    languages: ['English', 'Hindi'],
    screening_questions: [],
    screeningQuestions: [],
    status: 'active',
    paid: true,
    portfolio_required: false,
    portfolioRequired: false,
    published_at: '2026-09-22T08:00:00Z',
    employerName: 'Bandra Tape Studio',
    employerVerified: false,
    demo: true,
    applicationsCount: 0,
    createdAt: '2026-09-22T08:00:00Z',
    updatedAt: '2026-09-22T08:00:00Z',
  },
  {
    id: 'qa-job-3',
    employer_id: 'qa-hirer-3',
    title: 'Volunteer choir for a Diwali concert',
    company: 'Pune Cultural Society',
    location: 'Pune',
    kind: 'gig',
    type: 'gig',
    opportunity_kind: 'gig',
    genre: 'Folk',
    function_area: 'Performance',
    workplace: 'on_site',
    salary: null,
    currency: 'INR',
    compensation_min: null,
    compensation_max: null,
    description:
      'Unpaid community concert with a rehearsal every Sunday in October. Certificates and a recording provided.',
    skills: ['Choir'],
    languages: ['Marathi', 'Hindi'],
    screening_questions: [],
    screeningQuestions: [],
    status: 'active',
    paid: false,
    portfolio_required: false,
    portfolioRequired: false,
    published_at: '2026-09-25T08:00:00Z',
    employerName: 'Pune Cultural Society',
    employerVerified: false,
    demo: false,
    applicationsCount: 12,
    createdAt: '2026-09-25T08:00:00Z',
    updatedAt: '2026-09-25T08:00:00Z',
  },
];

export const fixtureActs: Act[] = [
  {
    id: 'qa-act-1',
    name: 'Saanjh Wedding Band',
    act_type: 'Band',
    status: 'active',
    tagline: 'Bollywood, Punjabi and sufi sets for sangeets and receptions',
    city: 'Mumbai',
    bio: 'Seven-piece band with dhol, keys and two vocalists. Sound and lights available.',
    promo_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    genres: ['Bollywood', 'Sufi', 'Punjabi'],
    languages: ['Hindi', 'Punjabi'],
    event_types: ['Wedding', 'Corporate'],
    lineup_size: 7,
    min_fee: 60000,
    max_fee: 150000,
    currency: 'INR',
    fee_basis: 'per_event',
    travels_nationally: true,
    verified: true,
    members: [
      {
        id: 'qa-member-1',
        displayName: 'Asha Kulkarni',
        roleName: 'Lead vocals',
        instrument: 'Vocals',
        isLeader: true,
        userId: 'qa-talent-1',
      },
      {
        id: 'qa-member-2',
        displayName: 'Rohan Deshpande',
        roleName: 'Percussion',
        instrument: 'Tabla',
        isLeader: false,
        userId: 'qa-talent-2',
      },
      { id: 'qa-member-3', displayName: 'Karan Malhotra', roleName: 'Keys', instrument: 'Keyboard', isLeader: false },
    ],
    ownerName: 'Asha Kulkarni',
    ownerVerified: true,
    demo: false,
  },
  {
    id: 'qa-act-2',
    name: 'Kolkata Jazz Trio',
    act_type: 'Trio',
    status: 'active',
    tagline: 'Late-night jazz standards and originals',
    city: 'Kolkata',
    genres: ['Jazz', 'Fusion'],
    languages: ['English', 'Bengali'],
    event_types: ['Private party', 'Club night'],
    lineup_size: 3,
    min_fee: 30000,
    max_fee: 45000,
    currency: 'INR',
    verified: false,
    members: [
      { id: 'qa-member-4', displayName: 'Sourav Sen', roleName: 'Piano', instrument: 'Piano', isLeader: true },
      { id: 'qa-member-5', displayName: 'Ira Bose', roleName: 'Bass', instrument: 'Double bass', isLeader: false },
    ],
    ownerName: 'Sourav Sen',
    ownerVerified: false,
    demo: true,
  },
  {
    id: 'qa-act-3',
    name: 'Nadia Solo Sufi',
    act_type: 'Solo artist',
    status: 'active',
    tagline: 'One voice, one harmonium',
    city: 'Delhi',
    genres: ['Sufi', 'Qawwali'],
    languages: ['Hindi', 'Urdu'],
    event_types: ['Wedding', 'Religious'],
    lineup_size: 1,
    min_fee: 25000,
    max_fee: null,
    currency: 'INR',
    verified: true,
    members: [
      { id: 'qa-member-6', displayName: 'Nadia Khan', roleName: 'Vocals', instrument: 'Harmonium', isLeader: true },
    ],
    ownerName: 'Nadia Khan',
    ownerVerified: true,
    demo: false,
  },
];

/** What the mocked API returns for the directory pages, by exact path. */
export const populatedFixtures = {
  '/api/jobs': { jobs: fixtureJobs, total: fixtureJobs.length, nextCursor: null, facets: {} },
  '/api/public/talent': { talent: fixtureTalent, total: fixtureTalent.length, nextCursor: null },
  '/api/public/acts': { acts: fixtureActs, total: fixtureActs.length, nextCursor: null },
} as const;

/** Detail lookups the cards make: a person's first sample, and the job and act pages. */
function detailFixture(pathname: string): unknown {
  const id = decodeURIComponent(pathname.split('/').pop() || '');
  if (pathname.startsWith('/api/public/talent/')) {
    const professional = fixtureTalent.find((t) => t.id === id);
    return professional ? { professional, portfolio: fixtureSamples[id] ?? [] } : undefined;
  }
  if (pathname.startsWith('/api/public/acts/')) {
    const act = fixtureActs.find((a) => a.id === id);
    return act ? { act } : undefined;
  }
  if (pathname.startsWith('/api/jobs/')) {
    const job = fixtureJobs.find((j) => j.id === id);
    return job ? { job } : undefined;
  }
  return undefined;
}

export function watchRuntimeFailures(page: Page) {
  const failures: string[] = [];
  const liveRun = Boolean(process.env.QA_BASE_URL);
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    // Local runs intentionally return 401 for /me so public pages exercise their
    // signed-out state without requiring a Rails service. Live runs stay strict.
    if (liveRun && message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) failures.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return failures;
}

export async function openSettledPage(page: Page, path: string) {
  if (!process.env.QA_BASE_URL && process.env.QA_INTEGRATION !== 'true') {
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/me')) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Authentication required' }),
        });
      }
      const fixtures: Record<string, unknown> = {
        ...populatedFixtures,
        '/api/search': { results: [], interpretedAs: [], provider: 'qa-fixture' },
        '/api/billing/plans': { plans: [] },
        '/api/taxonomy': { roleCategories: {}, genres: [], instruments: [] },
      };
      const fixtureKey = Object.keys(fixtures).find((key) => pathname === key);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureKey ? fixtures[fixtureKey] : (detailFixture(pathname) ?? {})),
      });
    });
  }
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `No document response for ${path}`).not.toBeNull();
  expect(response!.status(), `Document request failed for ${path}`).toBeLessThan(400);
  await expect(page.locator('body')).not.toContainText('Loading Verse…', { timeout: 12_000 });
  await page.waitForTimeout(150);
}

export async function assertNoHorizontalOverflow(page: Page, testInfo: TestInfo) {
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.right > viewport + 2 || box.left < -2;
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || '').trim().slice(0, 60),
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }));
    return { viewport, scrollWidth: document.documentElement.scrollWidth, offenders };
  });

  if (overflow.scrollWidth > overflow.viewport + 2) {
    await testInfo.attach('horizontal-overflow.json', {
      body: JSON.stringify(overflow, null, 2),
      contentType: 'application/json',
    });
  }
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.viewport + 2);
}

/** Picks an option from an AppSelect (the Radix listbox that replaced native <select>s). */
export async function chooseOption(trigger: Locator, option: string | RegExp) {
  await trigger.click();
  await trigger
    .page()
    .getByRole('option', { name: option, exact: typeof option === 'string' })
    .click();
}
