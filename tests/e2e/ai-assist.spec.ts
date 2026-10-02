import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API regressions for the AI Assist writing helpers, launch mode: only profile_headline,
// profile_bio, job_description and job_screening_questions are ever listed or callable; every
// other task (message_reply, improve_text, cover_letter, recruiter tasks…) is disabled, and the
// 402 paywall is a friendly "used up" notice with no purchase offer.
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

// The real GET /api/ai/status at launch: only these four tasks, ever.
const AI_STATUS_ENABLED = {
  enabled: true,
  tasks: ['job_description', 'job_screening_questions', 'profile_headline', 'profile_bio'],
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

test('a job description suggestion can be inserted, with no Improve button (improve_text is disabled)', async ({
  page,
}) => {
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
      await json(route, {
        suggestion: 'Record layered guitar parts for a feature film score over three sessions.',
        task,
        model: 'qa-model',
      });
      return true;
    }
    return false;
  });

  await page.goto('/employer/post-job');
  await page.getByLabel('Title').fill('Session guitarist');
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();

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

  // improve_text is launch-disabled: no "Improve with AI" button once there's draft text.
  await expect(page.getByRole('button', { name: 'Improve with AI' })).toHaveCount(0);
});

test('AI buttons and the usage hint are absent when AI assist is disabled', async ({ page }) => {
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
  await page.getByRole('combobox', { name: 'Location' }).fill('Mumbai');
  await page.getByRole('combobox', { name: 'Location' }).press('Enter');
  await page.getByRole('button', { name: 'Next: Pay & dates' }).click();
  await page.getByRole('button', { name: 'Next: Screen & review' }).click();

  await expect(page.getByRole('button', { name: 'Write with AI' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Improve with AI' })).toHaveCount(0);
  await expect(page.getByTestId('ai-credits-badge')).toHaveCount(0);
  expect(calls.some((c) => c.path === '/ai/suggest')).toBe(false);
});

test('a profile headline and bio suggestion can each be inserted, and the usage hint has no "credits" wording', async ({
  page,
}) => {
  await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/ai/usage') {
      await json(route, { remaining: 4, limit: 5, period: 'lifetime' });
      return true;
    }
    if (path === '/ai/suggest') {
      const task = (route.request().postDataJSON() as { task: string }).task;
      const suggestion = task === 'profile_headline' ? 'Session guitarist, Hindi and English rock' : 'I play guitar.';
      await json(route, { suggestion, task, model: 'qa-model' });
      return true;
    }
    return false;
  });

  await page.goto('/jobseeker/profile');
  await page.getByRole('button', { name: 'Write with AI' }).first().click();
  await expect(page.getByText('Session guitarist, Hindi and English rock')).toBeVisible();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Headline')).toHaveValue('Session guitarist, Hindi and English rock');

  await page.getByRole('button', { name: 'Write with AI' }).nth(1).click();
  await expect(page.getByText('I play guitar.')).toBeVisible();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Bio')).toHaveValue('I play guitar.');

  const hint = page.getByTestId('ai-credits-badge');
  if (await hint.count()) {
    await expect(hint).toContainText('AI help');
    await expect(hint).not.toContainText('credit');
  }
});

test('message_reply is disabled: no "Suggest a reply" button in Messages', async ({ page }) => {
  const calls = await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/conversations') {
      await json(route, {
        conversations: [
          {
            id: 'conv-1',
            counterpartName: 'Studio',
            counterpartId: 'them',
            unreadCount: 0,
            lastMessageAt: '2026-09-27T10:00:00Z',
          },
        ],
      });
      return true;
    }
    if (path === '/conversations/conv-1/messages' && route.request().method() === 'GET') {
      await json(route, {
        messages: [
          {
            id: 'm1',
            senderId: 'them',
            body: 'Are you free next weekend?',
            createdAt: '2026-09-27T10:00:00Z',
            readAt: null,
          },
        ],
        theirReadAt: null,
      });
      return true;
    }
    return false;
  });

  await page.goto('/jobseeker/messages?c=conv-1');
  await expect(page.getByRole('button', { name: 'Suggest a reply with AI' })).toHaveCount(0);
  expect(calls.some((c) => c.path === '/ai/suggest')).toBe(false);
});

test('a used-up AI usage cap (402) shows a friendly notice with no purchase offer', async ({ page }) => {
  await mockRoutes(page, jobseeker, async (route, path) => {
    if (path === '/ai/status') {
      await json(route, AI_STATUS_ENABLED);
      return true;
    }
    if (path === '/ai/usage') {
      await json(route, { remaining: 0, limit: 5, period: 'lifetime' });
      return true;
    }
    if (path === '/ai/suggest') {
      await json(route, { error: 'AI help is used up for now.', code: 'AI_USAGE_LIMIT_REACHED' }, 402);
      return true;
    }
    return false;
  });

  await page.goto('/jobseeker/profile');
  await page.getByRole('button', { name: 'Write with AI' }).first().click();
  await expect(page.getByRole('dialog', { name: 'AI help is used up for now' })).toBeVisible();
  await expect(page.getByRole('button', { name: /MusiLynk AI Plus/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Top up/ })).toHaveCount(0);
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
