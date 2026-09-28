import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API regressions for the AI Assist writing helpers: suggest/insert/replace, the reply
// suggestion in Messages, the 402 paywall, and AI hiding entirely when the feature is disabled.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};
const jobseeker = {
  id: 'qa-jobseeker',
  name: 'QA Jobseeker',
  email: 'jobseeker@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

const AI_STATUS_ENABLED = {
  enabled: true,
  tasks: [
    'job_description',
    'job_screening_questions',
    'profile_headline',
    'profile_bio',
    'improve_text',
    'message_reply',
  ],
};
const AI_STATUS_DISABLED = { enabled: false, tasks: [] };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockRoutes(
  page: Page,
  user: Record<string, unknown>,
  handler: (route: Route, path: string) => Promise<boolean> | boolean,
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
    if (path === '/me') return json(route, { user });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    const handled = await handler(route, path);
    if (handled !== true) return json(route, {});
  });
  return calls;
}

test('a job description suggestion can be inserted, and Improve can replace it', async ({ page }) => {
  await mockRoutes(page, employer, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/me/identities') {
      await json(route, { identities: [] });
      return true;
    }
    if (path === '/employer/jobs') {
      await json(route, { jobs: [] });
      return true;
    }
    if (path === '/ai/suggest') {
      const task = (route.request().postDataJSON() as { task: string }).task;
      const suggestion =
        task === 'job_description'
          ? 'Record layered guitar parts for a feature film score over three sessions.'
          : 'Record layered guitar parts for a film score over three focused sessions.';
      await json(route, { suggestion, task, model: 'qa-model' });
      return true;
    }
    return false;
  });

  await page.goto('/employer/post-job');
  await page.getByLabel('Title').fill('Session guitarist');
  await page.getByLabel('Location').fill('Mumbai');
  await page.getByLabel('Location').press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();

  // Write with AI (job_description) always replaces — no draft text yet to insert alongside.
  await page.getByRole('button', { name: 'Write with AI' }).click();
  await expect(page.getByText('Record layered guitar parts for a feature film score')).toBeVisible();
  const axeResult = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axeResult.violations, axeResult.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n')).toEqual(
    [],
  );
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel(/^Description/)).toHaveValue(
    'Record layered guitar parts for a feature film score over three sessions.',
  );

  // Improve (improve_text) offers Insert too, appending the AI text below what's already there.
  await page.getByRole('button', { name: 'Improve with AI' }).click();
  await expect(
    page.getByText('Record layered guitar parts for a film score over three focused sessions.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Insert' }).click();
  await expect(page.getByLabel(/^Description/)).toHaveValue(
    'Record layered guitar parts for a feature film score over three sessions.\n\nRecord layered guitar parts for a film score over three focused sessions.',
  );
});

test('AI buttons and the credits badge are absent when AI assist is disabled', async ({ page }) => {
  const calls = await mockRoutes(page, employer, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_DISABLED);
      return true;
    }
    if (path === '/me/identities') {
      await json(route, { identities: [] });
      return true;
    }
    if (path === '/employer/jobs') {
      await json(route, { jobs: [] });
      return true;
    }
    return false;
  });

  await page.goto('/employer/post-job');
  await page.getByLabel('Title').fill('Session guitarist');
  await page.getByLabel('Location').fill('Mumbai');
  await page.getByLabel('Location').press('Enter');
  await page.getByRole('button', { name: 'Next: Details' }).click();

  await expect(page.getByRole('button', { name: 'Write with AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Improve with AI' })).toHaveCount(0);
  expect(calls.some((c) => c.path === '/ai/suggest')).toBe(false);
});

test('a profile headline and bio suggestion can each be inserted', async ({ page }) => {
  await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/ai/suggest') {
      const task = (route.request().postDataJSON() as { task: string }).task;
      const suggestion = task === 'profile_headline' ? 'Session guitarist, Hindi & English rock' : 'I play guitar.';
      await json(route, { suggestion, task, model: 'qa-model' });
      return true;
    }
    return false;
  });

  await page.goto('/jobseeker/profile');
  await page.getByRole('button', { name: 'Write with AI' }).first().click();
  await expect(page.getByText('Session guitarist, Hindi & English rock')).toBeVisible();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Professional headline')).toHaveValue('Session guitarist, Hindi & English rock');

  await page.getByRole('button', { name: 'Write with AI' }).nth(1).click();
  await expect(page.getByText('I play guitar.')).toBeVisible();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Bio')).toHaveValue('I play guitar.');
});

const conversationId = 'conv-1';
const messages = [
  { id: 'm1', senderId: 'them', body: 'Are you free next weekend?', createdAt: '2026-09-27T10:00:00Z', readAt: null },
];

test('Suggest a reply fills the composer without sending anything', async ({ page }) => {
  const calls = await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/conversations') {
      await json(route, {
        conversations: [
          {
            id: conversationId,
            counterpartName: 'Studio',
            counterpartId: 'them',
            unreadCount: 0,
            lastMessageAt: messages[0].createdAt,
          },
        ],
      });
      return true;
    }
    if (path === `/conversations/${conversationId}/messages` && route.request().method() === 'GET') {
      await json(route, { messages, theirReadAt: null });
      return true;
    }
    if (path === '/ai/suggest') {
      await json(route, { suggestion: 'Yes, I can do Saturday afternoon!', task: 'message_reply', model: 'qa-model' });
      return true;
    }
    return false;
  });

  await page.goto(`/jobseeker/messages?c=${conversationId}`);
  await page.getByRole('button', { name: 'Suggest a reply with AI' }).click();
  await expect(page.getByText('Yes, I can do Saturday afternoon!')).toBeVisible();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Yes, I can do Saturday afternoon!');
  // Never sent on the person's behalf: no POST to the messages endpoint happened from the suggestion.
  expect(calls.some((c) => c.method === 'POST' && c.path === `/conversations/${conversationId}/messages`)).toBe(false);
});

test('an AI credits paywall (402) offers Verse AI Plus and a top-up instead of a broken suggestion', async ({
  page,
}) => {
  await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/ai/pricing') {
      await json(route, {
        freeCreditsPerMonth: 20,
        aiPlus: { planCode: 'ai_plus', priceInr: 199, creditsPerMonth: 400 },
        planAllowances: { pro: 500, studio: 2000, enterprise: null },
        topups: { small: { priceInr: 99, credits: 150 } },
        topupExpiresAfterMonths: 12,
        taskCosts: { profile_headline: 1 },
      });
      return true;
    }
    if (path === '/ai/usage') {
      await json(route, {
        balance: 0,
        monthlyAllowance: 20,
        usedThisPeriod: 20,
        resetsAt: '2026-10-01',
        plan: 'free',
        recent: [],
      });
      return true;
    }
    if (path === '/ai/suggest') {
      await json(
        route,
        { error: "You're out of AI credits.", code: 'AI_CREDITS_EXHAUSTED', balance: 0, resetsAt: '2026-10-01' },
        402,
      );
      return true;
    }
    return false;
  });

  await page.goto('/jobseeker/profile');
  await page.getByRole('button', { name: 'Write with AI' }).first().click();
  await expect(page.getByRole('dialog', { name: "You're out of AI credits" })).toBeVisible();
  await expect(page.getByTestId('ai-paywall-balance')).toContainText('0 credits');
  await expect(page.getByRole('button', { name: /Verse AI Plus/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Top up/ })).toBeVisible();
  const paywallAxe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    paywallAxe.violations,
    paywallAxe.violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n'),
  ).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
