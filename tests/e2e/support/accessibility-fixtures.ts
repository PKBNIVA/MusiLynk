import type { Page } from '@playwright/test';
import type {
  Application,
  Booking,
  EmployerApplication,
  EmployerDashboard,
  Job,
  JobSeekerDashboard,
  Professional,
} from '../../../src/app/lib/apiTypes';
import { fixtureActs, fixtureJobs, fixtureTalent } from '../qa-helpers';
import { CONVERSATION_ID, signInWithDialogFixtures } from './dialog-fixtures';
import { identities, library, portfolio } from './showcase-fixtures';

// Populated replies for the signed-in screens the accessibility gate (tests/e2e/accessibility.spec.ts)
// sweeps, layered over signInWithDialogFixtures (which signs the person in, answers /me, /conversations
// and the thread, and `{}` for everything else). Populated pages exercise the cards, tables, badges and
// controls an empty state never renders. Typed with the pages' own interfaces so a field they start to
// need fails the typecheck here instead of silently rendering an empty state.

export type Role = 'jobseeker' | 'employer';

/** A screen the gate opens: who is signed in, where, and a text that proves its data rendered. */
export const signedInScreens: { name: string; role: Role; path: string; ready?: string }[] = [
  { name: 'Musician dashboard', role: 'jobseeker', path: '/jobseeker', ready: fixtureJobs[0].title },
  { name: 'Hirer dashboard', role: 'employer', path: '/employer' },
  {
    name: 'Messages with an open thread',
    role: 'jobseeker',
    path: `/jobseeker/messages?c=${CONVERSATION_ID}`,
    ready: 'pay me first',
  },
  { name: 'Bookings', role: 'jobseeker', path: '/jobseeker/bookings', ready: fixtureActs[0].name },
  { name: 'Profile setup', role: 'jobseeker', path: '/jobseeker/profile', ready: 'Headline' },
  { name: 'Post an opportunity', role: 'employer', path: '/employer/post-job' },
  { name: 'Applications (musician)', role: 'jobseeker', path: '/jobseeker/applications', ready: fixtureJobs[0].title },
  { name: 'Applicants (hirer)', role: 'employer', path: '/employer/applications', ready: fixtureTalent[0].name },
  { name: 'Work library', role: 'jobseeker', path: '/jobseeker/library', ready: 'Live at NH7 Weekender' },
];

const at = (job: Job) => job.published_at ?? '2026-09-20T08:00:00Z';

const application = (job: Job, status: string, index: number): Application => {
  const interview = status === 'Interview Scheduled' ? '2026-10-20T10:00:00Z' : null;
  return {
    id: `qa-application-${index}`,
    job_id: job.id,
    candidate_id: 'me-1',
    status,
    cover_letter: null,
    interview_date: interview,
    screening_answers: [],
    created_at: at(job),
    updated_at: at(job),
    jobId: job.id,
    coverLetter: null,
    interviewDate: interview,
    createdAt: at(job),
    updatedAt: at(job),
    screeningAnswers: [],
    opportunityKind: job.opportunity_kind,
    workplace: job.workplace,
    title: job.title,
    company: job.company,
    location: job.location,
  };
};

const employerApplication = (job: Job, talent: Professional, status: string, index: number): EmployerApplication => ({
  ...application(job, status, index),
  candidate_id: talent.id,
  recruiter_rating: index === 0 ? 4 : null,
  recruiter_note: null,
  recruiterRating: index === 0 ? 4 : null,
  recruiterNote: null,
  jobTitle: job.title,
  candidateId: talent.id,
  candidateName: talent.name,
  headline: talent.headline,
  candidateLocation: talent.location,
  experience: talent.yearsExperience ? `${talent.yearsExperience} years` : null,
  skills: talent.instruments ?? [],
  genres: talent.genres ?? [],
  verified: Boolean(talent.verified),
  allowedNextStatuses:
    status === 'Applied' ? ['Under Review', 'Shortlisted', 'Rejected'] : ['Interview Scheduled', 'Offer', 'Rejected'],
});

const applications: Application[] = [
  application(fixtureJobs[0], 'Under Review', 1),
  application(fixtureJobs[1], 'Interview Scheduled', 2),
  application(fixtureJobs[2], 'Applied', 3),
];

const employerApplications: EmployerApplication[] = [
  employerApplication(fixtureJobs[0], fixtureTalent[0], 'Applied', 1),
  employerApplication(fixtureJobs[0], fixtureTalent[1], 'Shortlisted', 2),
  employerApplication(fixtureJobs[1], fixtureTalent[2], 'Interview Scheduled', 3),
];

const bookings: Booking[] = [
  {
    id: 'qa-booking-1',
    act_id: fixtureActs[0].id,
    requester_id: 'me-1',
    event_type: 'Wedding',
    event_name: 'Sangeet night',
    city: 'Mumbai',
    currency: 'INR',
    status: 'quoted',
    event_date: '2026-11-14',
    start_time: '19:00',
    venue_name: 'Juhu Lawns',
    indoor_outdoor: 'outdoor',
    duration_minutes: 180,
    audience_size: 300,
    budget_min: 60000,
    budget_max: 90000,
    requirements: 'Two 90-minute sets, Bollywood and Punjabi, sound and lights provided.',
    production_provided: ['Sound', 'Lights'],
    travel_provided: false,
    accommodation_provided: false,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    actName: fixtureActs[0].name,
    requesterName: 'Asha Rao',
    isOwner: false,
    isRequester: true,
    latestQuoteTotal: 75000,
    latestQuoteCurrency: 'INR',
    latestDepositPercent: 25,
    latestQuote: {
      id: 'qa-quote-1',
      performanceFee: 65000,
      travelFee: 5000,
      productionFee: 5000,
      otherFee: 0,
      total: 75000,
      currency: 'INR',
      depositPercent: 25,
      validUntil: '2026-10-31T00:00:00Z',
      inclusions: 'Seven-piece lineup, dhol, two vocalists.',
      exclusions: 'Stage and generator.',
      cancellationTerms: 'Deposit refundable up to 14 days before the event.',
      status: 'sent',
      feeAmount: 0,
      gstAmount: 0,
      feePercent: 0,
      policyVersion: 1,
    },
    paidAmount: 0,
    paymentCount: 0,
    depositPaid: false,
    allowedTransitions: ['accepted', 'negotiating', 'cancelled'],
  },
  {
    id: 'qa-booking-2',
    act_id: fixtureActs[2].id,
    requester_id: 'qa-hirer-2',
    event_type: 'Corporate',
    event_name: 'Diwali town hall',
    city: 'Delhi',
    currency: 'INR',
    status: 'accepted',
    event_date: '2026-10-28',
    start_time: '18:30',
    venue_name: 'Aerocity convention hall',
    duration_minutes: 60,
    audience_size: 500,
    budget_min: 25000,
    budget_max: 40000,
    requirements: null,
    production_provided: ['Sound'],
    travel_provided: true,
    accommodation_provided: false,
    created_at: '2026-09-28T10:00:00Z',
    updated_at: '2026-10-05T10:00:00Z',
    actName: fixtureActs[2].name,
    requesterName: 'Bandra Tape Studio',
    isOwner: true,
    isRequester: false,
    latestQuoteTotal: 30000,
    latestQuoteCurrency: 'INR',
    latestDepositPercent: 25,
    latestQuote: null,
    paidAmount: 7500,
    paymentCount: 1,
    depositPaid: true,
    allowedTransitions: ['completed', 'cancelled'],
  },
];

const dashboards: Record<Role, JobSeekerDashboard | EmployerDashboard> = {
  jobseeker: {
    applications: applications.length,
    interviews: 1,
    saved: 2,
    profileScore: 72,
    recommendedJobs: fixtureJobs.map((job, index) => ({ ...job, fitScore: 90 - index * 10 })),
    urgentNearby: {
      count: 1,
      items: [
        {
          id: 'qa-urgent-1',
          title: 'Dhol player for a baraat',
          city: 'Mumbai',
          roleName: 'Dhol player',
          startAt: '2026-10-12T14:00:00Z',
        },
      ],
    },
  },
  employer: {
    jobs: fixtureJobs.length,
    published: 2,
    activeJobs: 2,
    applications: employerApplications.length,
    shortlisted: 1,
    recentJobs: fixtureJobs,
  },
};

/** Replies by `/api`-relative pathname (query string ignored) for GET requests; everything else falls through. */
function replies(role: Role): Record<string, unknown> {
  return {
    '/dashboard': dashboards[role],
    '/applications': { applications },
    '/employer/applications': { applications: employerApplications },
    '/employer/jobs': { jobs: fixtureJobs },
    '/bookings': { bookings },
    '/portfolio': { items: library() },
    '/portfolios': { portfolios: [portfolio()] },
    '/suggestions': { suggestions: [] },
    '/me/identities': { identities },
    '/jobs/limits': { activeAllowed: 3, activeUsed: 1, plan: 'free', planName: 'Free' },
    '/availability': { windows: [] },
  };
}

/** Signs in as `role` with the dialog fixtures, then answers the data the core screens list. */
export async function signInForAccessibility(page: Page, role: Role) {
  const state = await signInWithDialogFixtures(page, role);
  const table = replies(role);
  // Registered after signInWithDialogFixtures's catch-all, so Playwright consults this handler first.
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const reply = request.method() === 'GET' ? table[path] : undefined;
    if (reply === undefined) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return state;
}

/** GET /api/public/hire-pages/drummer/mumbai, as HirePage.tsx reads it (mirrors hire-pages.spec.ts). */
export const HIRE_PAGE_FIXTURE = {
  role: { slug: 'drummer', label: 'Drummer' },
  city: { slug: 'mumbai', name: 'Mumbai' },
  counts: { professionals: 12, verified: 5, availableThisWeek: 3 },
  featured: fixtureTalent,
  relatedRoles: [
    { slug: 'guitarist', label: 'Guitarist', count: 9 },
    { slug: 'dhol-player', label: 'Dhol player', count: 4 },
  ],
  nearbyCities: [
    { slug: 'pune', name: 'Pune' },
    { slug: 'goa', name: 'Goa' },
  ],
  indexable: true,
  ratesPath: '/rates/mumbai',
  faq: [
    {
      question: 'How much does a session drummer in Mumbai charge?',
      answer: 'Rates vary by experience and event; ask for a quote through MusiLynk.',
    },
    {
      question: 'How fast can I book a drummer in Mumbai?',
      answer: 'Most urgent requests get a first response within hours.',
    },
    { question: 'Are drummers on MusiLynk in Mumbai verified?', answer: 'Every profile shows real, reviewable work.' },
    { question: 'What does it cost to hire a drummer for a gig in Mumbai?', answer: 'See rates at /rates/mumbai.' },
  ],
};

/** GET /api/public/rates/mumbai, as RatesPage.tsx reads it (mirrors RatesPage.test.tsx). */
export const RATES_PAGE_FIXTURE = {
  city: { slug: 'mumbai', name: 'Mumbai' },
  roles: [
    {
      slug: 'drummer',
      label: 'Drummer',
      n: 8,
      hasData: true,
      sessionRate: { median: 4000, p25: 3000, p75: 5000, n: 8 },
      showRate: { median: 12000, p25: 9000, p75: 15000, n: 6 },
      dayRate: null,
    },
    {
      slug: 'singer',
      label: 'Singer',
      n: 11,
      hasData: true,
      sessionRate: { median: 8000, p25: 6000, p75: 12000, n: 11 },
      showRate: { median: 25000, p25: 18000, p75: 35000, n: 9 },
      dayRate: { median: 15000, p25: 12000, p75: 20000, n: 5 },
    },
    { slug: 'guitarist', label: 'Guitarist', n: 2, hasData: false, sessionRate: null, showRate: null, dayRate: null },
  ],
  indexable: true,
  updatedAt: '2026-09-01T00:00:00Z',
};
