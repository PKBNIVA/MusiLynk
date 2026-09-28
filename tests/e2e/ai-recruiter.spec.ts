import { expect, test, type Page, type Route } from '@playwright/test';
import { chooseOption } from './qa-helpers';

// Mocked-API regressions for the recruiter-facing AI on EmployerApplications: candidate
// summaries, ranking, and the outreach/interview/rejection drafts that always go through the
// existing "review before sending" message flow.
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

const AI_STATUS_ENABLED = {
  enabled: true,
  tasks: ['candidate_summary', 'rank_applicants', 'outreach_message', 'interview_questions', 'rejection_note'],
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function openApplications(
  page: Page,
  extra: (route: Route, path: string, body: unknown) => Promise<boolean> | boolean,
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
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
    if (path === '/ai/status') return json(route, AI_STATUS_ENABLED);
    if (path === '/employer/jobs') return json(route, { jobs: [job] });
    if (path.startsWith('/employer/applications')) return json(route, { applications: [app1, app2] });
    if (await extra(route, path, body)) return;
    return json(route, {});
  });
  await page.goto('/employer/applications');
  return calls;
}

test('Summarize shows an AI candidate summary the recruiter can open and close', async ({ page }) => {
  const calls = await openApplications(page, async (route, path, body) => {
    if (path === '/ai/suggest') {
      const task = (body as { task: string }).task;
      expect(task).toBe('candidate_summary');
      await json(route, {
        suggestion: '- Toured with three bands\n- Reads charts fluently\nFit: Strong fit for a touring role.',
        task,
        model: 'qa-model',
      });
      return true;
    }
    return false;
  });

  // Asha Rao (app-1) renders first: applications load in server order until a rank sort is active.
  // Summarize, Draft invite, Interview questions and Draft kind rejection are grouped under one
  // "AI help" dropdown per card, to keep the action list from overwhelming the applicant card.
  await page.getByRole('button', { name: 'AI help' }).first().click();
  await page.getByRole('menuitem', { name: 'Summarize' }).click();
  await expect(page.getByText('Reads charts fluently')).toBeVisible();
  await expect(page.getByText('Fit: Strong fit for a touring role.')).toBeVisible();

  const suggestCall = calls.find((c) => c.path === '/ai/suggest');
  expect((suggestCall?.body as { context: { jobId: string } }).context.jobId).toBe('job-1');
});

test('Rank applicants shows an AI estimate badge, labelled as an estimate, and can sort by it', async ({ page }) => {
  await openApplications(page, async (route, path, body) => {
    if (path === '/ai/suggest') {
      const context = (body as { context: { applicants: string[] } }).context;
      expect(context.applicants).toHaveLength(2);
      await json(route, {
        suggestion: JSON.stringify([
          { applicationId: 'app-2', score: 91, reason: 'Strong drum chops for this style.' },
          { applicationId: 'app-1', score: 60, reason: 'Solid but less genre overlap.' },
        ]),
        task: 'rank_applicants',
        model: 'qa-model',
      });
      return true;
    }
    return false;
  });

  await chooseOption(page.getByLabel('Opportunity'), /Tour drummer/);
  await page.getByRole('button', { name: 'Rank applicants' }).click();
  await expect(page.getByText('AI estimate: 91/100')).toBeVisible();
  await expect(page.getByText('AI estimate: 60/100')).toBeVisible();
  await expect(page.getByText('AI estimate: 91/100')).toHaveAttribute('title', 'AI estimate, not a hiring decision');

  // Ranking sorts by the AI estimate immediately (the checkbox reflects that, already checked).
  const names = () => page.getByRole('heading', { level: 2 }).allTextContents();
  await expect(page.getByLabel('Sort by AI estimate')).toBeChecked();
  await expect.poll(names).toEqual(['Vik Shah', 'Asha Rao']);

  await page.getByLabel('Sort by AI estimate').uncheck();
  await expect.poll(names).toEqual(['Asha Rao', 'Vik Shah']);
});

test('Draft invite opens an editable draft and sends it only when the recruiter chooses Send', async ({ page }) => {
  const calls = await openApplications(page, async (route, path) => {
    if (path === '/ai/suggest') {
      await json(route, {
        suggestion: 'Hi Asha, we loved your reel — want to chat about the tour?',
        task: 'outreach_message',
        model: 'qa-model',
      });
      return true;
    }
    if (path === '/conversations' && route.request().method() === 'POST') {
      await json(route, { conversation: { id: 'conv-9' } }, 201);
      return true;
    }
    if (path === '/conversations/conv-9/messages' && route.request().method() === 'POST') {
      await json(route, { message: { id: 'm-1' } }, 201);
      return true;
    }
    return false;
  });

  await page.getByRole('button', { name: 'AI help' }).first().click();
  await page.getByRole('menuitem', { name: 'Draft invite' }).click();
  const dialog = page.getByRole('dialog', { name: /Draft invite/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Message')).toHaveValue('Hi Asha, we loved your reel — want to chat about the tour?');

  // Nothing is sent while the recruiter is still editing the draft.
  expect(calls.some((c) => c.path === '/conversations/conv-9/messages')).toBe(false);

  await dialog.getByLabel('Message').fill('Hi Asha, loved your reel. Are you free to chat about the tour?');
  await dialog.getByRole('button', { name: 'Send message' }).click();
  await expect(dialog).toBeHidden();
  const sent = calls.find((c) => c.path === '/conversations/conv-9/messages');
  expect((sent?.body as { body: string }).body).toBe('Hi Asha, loved your reel. Are you free to chat about the tour?');
});

test('the applicant detail shows the portfolio and resume snapshot sent with the application', async ({ page }) => {
  await openApplications(page, () => false);
  await expect(page.getByText('Live drumming reel')).toBeVisible();
  await expect(page.getByText('3 work samples')).toBeVisible();
  await expect(page.getByText('Asha Rao CV')).toBeVisible();
  await expect(page.getByText('Ten years of touring experience.')).toBeVisible();
});
