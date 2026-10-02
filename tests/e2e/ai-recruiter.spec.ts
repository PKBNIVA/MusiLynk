import { expect, test, type Page, type Route } from '@playwright/test';

// Recruiter AI (candidate_summary, rank_applicants, outreach_message, interview_questions,
// rejection_note) is launch-disabled — GET /api/ai/status never lists it, so EmployerApplications
// hides every "AI help" affordance for it entirely (each is gated by useAiTaskEnabled). This spec
// checks that absence; the earlier positive-flow coverage of these tasks is superseded by
// backend/test/integration/ai_controller_test.rb's 403 AI_TASK_DISABLED coverage.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};

const job = { id: 'job-1', title: 'Tour drummer', status: 'published', requirements: 'Reads charts.' };

const app1 = {
  id: 'app-1',
  jobId: 'job-1',
  jobTitle: 'Tour drummer',
  candidateId: 'cand-1',
  candidateName: 'Asha Rao',
  candidateEmail: 'asha@example.invalid',
  headline: 'Session drummer',
  coverLetter: 'I have toured with three bands.',
  status: 'Under Review',
  skills: ['Drums'],
  screeningAnswers: ['Available for touring? :: Yes'],
  allowedNextStatuses: ['Shortlisted', 'Interview Scheduled', 'Rejected'],
  materials: {
    capturedAt: '2026-09-01T00:00:00Z',
    portfolio: { title: 'Live drumming reel', headline: 'Rock & fusion', itemCount: 3 },
    resume: { title: 'Asha Rao CV', summary: 'Ten years of touring experience.', sections: ['Experience', 'Skills'] },
  },
};
const app2 = {
  id: 'app-2',
  jobId: 'job-1',
  jobTitle: 'Tour drummer',
  candidateId: 'cand-2',
  candidateName: 'Vik Shah',
  candidateEmail: 'vik@example.invalid',
  headline: 'Session drummer',
  coverLetter: '',
  status: 'Under Review',
  skills: ['Drums'],
  screeningAnswers: [],
  allowedNextStatuses: ['Shortlisted', 'Interview Scheduled', 'Rejected'],
};

// The real GET /api/ai/status at launch: no recruiter task is ever listed.
const AI_STATUS_LAUNCH = {
  enabled: true,
  tasks: ['job_description', 'job_screening_questions', 'profile_headline', 'profile_bio'],
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openApplications(
  page: Page,
  extra: (route: Route, path: string, body: unknown) => Promise<boolean> | boolean = () => false,
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('musilynk_access_token', 'qa-token'));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    calls.push({ method: request.method(), path, body });
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, AI_STATUS_LAUNCH);
    if (path === '/employer/jobs') return json(route, { jobs: [job] });
    if (path.startsWith('/employer/applications')) return json(route, { applications: [app1, app2] });
    if (await extra(route, path, body)) return;
    return json(route, {});
  });
  await page.goto('/employer/applications');
  return calls;
}

test('no recruiter AI is offered: no "AI help" dropdown and no "Rank applicants" button', async ({ page }) => {
  const calls = await openApplications(page);

  await expect(page.getByRole('button', { name: 'AI help' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rank applicants' })).toHaveCount(0);
  expect(calls.some((c) => c.path === '/ai/suggest')).toBe(false);
});

test('the applicant detail still shows the portfolio and resume snapshot sent with the application', async ({
  page,
}) => {
  await openApplications(page);
  await expect(page.getByText('Live drumming reel')).toBeVisible();
  await expect(page.getByText('3 work samples')).toBeVisible();
  await expect(page.getByText('Asha Rao CV')).toBeVisible();
  await expect(page.getByText('Ten years of touring experience.')).toBeVisible();
});
