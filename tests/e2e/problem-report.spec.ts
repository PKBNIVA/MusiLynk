import { expect, test, type Page } from '@playwright/test';

// "Report a problem": the dialog from the account menu, the landing footer (signed out) and the
// error screen, with a screenshot attached from a file or captured from the page. The API is
// mocked; the real endpoint is covered by backend/test/integration/problem_reports_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const user = {
  id: 'me-1',
  name: 'Asha Rao',
  email: 'asha@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
  emailVerified: true,
};

type Sent = { contentType: string; body: string }[];

async function mockApi(
  page: Page,
  options: { signedIn: boolean; crashJob?: boolean; reply?: object; status?: number },
) {
  const sent: Sent = [];
  await page.addInitScript((signedIn) => {
    if (signedIn) localStorage.setItem('verse_access_token', 'qa-token-secret-123');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
    localStorage.setItem('verse-tour-v2-employer', 'done');
  }, options.signedIn);
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/me') return options.signedIn ? json({ user }) : json({ error: 'Authentication required' }, 401);
    if (path === '/problem-reports' && request.method() === 'POST') {
      sent.push({
        contentType: request.headers()['content-type'] ?? '',
        body: request.postDataBuffer()?.toString('latin1') ?? '',
      });
      return json(options.reply ?? { id: 'prob_1', screenshotSaved: true }, options.status ?? 201);
    }
    if (options.crashJob && path === '/jobs/job-1')
      return json({
        job: {
          id: 'job-1',
          company: 'Verse Studio',
          location: 'Mumbai',
          kind: 'Contract',
          skills: [],
          title: { boom: 1 },
        },
      });
    return json({});
  });
  return sent;
}

test('a signed-in person reports a problem with a screenshot from the account menu', async ({ page }) => {
  const sent = await mockApi(page, { signedIn: true });
  await page.goto('/jobseeker?token=abc123secret&tab=overview');
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Report a problem' }).click();

  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();

  // What happened is required, and nothing is sent without it.
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Tell us what happened.');
  expect(sent).toHaveLength(0);

  // The context is shown before sending, with the token stripped from the page.
  const context = dialog.getByTestId('problem-report-context');
  await expect(context).toContainText('/jobseeker?tab=overview');
  await expect(context).not.toContainText('abc123secret');
  await expect(context).toContainText('Musician or crew');

  await dialog.getByLabel('What happened?').fill('The save button spins forever on my profile.');
  await dialog.getByLabel('What did you expect? (optional)').fill('My changes to be saved.');

  // A file that is not an image is refused with a clear message.
  await dialog
    .getByTestId('problem-report-file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(dialog.getByRole('alert')).toHaveText('Choose a PNG, JPEG or WebP image.');

  // A screenshot shows a preview that can be removed and added again.
  await dialog
    .getByTestId('problem-report-file')
    .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByRole('img', { name: 'Preview of your screenshot' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove screenshot' }).click();
  await expect(dialog.getByRole('img', { name: 'Preview of your screenshot' })).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Attach a screenshot' })
    .click()
    .catch(() => undefined);
  await dialog
    .getByTestId('problem-report-file')
    .setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByRole('img', { name: 'Preview of your screenshot' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks, we have your report' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  expect(sent).toHaveLength(1);
  const { contentType, body } = sent[0];
  expect(contentType).toContain('multipart/form-data');
  expect(body).toContain('The save button spins forever on my profile.');
  expect(body).toContain('My changes to be saved.');
  expect(body).toContain('filename="shot.png"');
  expect(body).toContain('/jobseeker?tab=overview');
  // Never the session token, the page's secret query value or an email address.
  expect(body).not.toContain('qa-token-secret-123');
  expect(body).not.toContain('abc123secret');
  expect(body).not.toContain('name="email"');
});

test('unticking the details sends no page or context', async ({ page }) => {
  const sent = await mockApi(page, { signedIn: true });
  await page.goto('/jobseeker');
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Report a problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await dialog.getByLabel('What happened?').fill('Something odd.');
  await dialog.getByRole('checkbox', { name: /Include these details/ }).uncheck();
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks, we have your report' })).toBeVisible();
  expect(sent[0].body).toContain('name="includeContext"\r\n\r\nfalse');
  expect(sent[0].body).not.toContain('name="page"');
  expect(sent[0].body).not.toContain('name="context"');
});

test('a signed-out visitor reports from the footer and must leave an email', async ({ page }) => {
  const sent = await mockApi(page, { signedIn: false });
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('button', { name: 'Report a problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Your email')).toBeVisible();
  await expect(dialog.getByText('Account type')).toHaveCount(0);

  await dialog.getByLabel('What happened?').fill('The pricing page shows a blank table.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Add your email so we can reply.');
  expect(sent).toHaveLength(0);

  await dialog.getByLabel('Your email').fill('visitor@example.com');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks, we have your report' })).toBeVisible();
  expect(sent[0].body).toContain('visitor@example.com');
  expect(sent[0].body).not.toContain('name="website"');
});

test('a refused report keeps the dialog open with the reason', async ({ page }) => {
  await mockApi(page, { signedIn: false, status: 429, reply: { error: 'Too many requests. Try again later.' } });
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('button', { name: 'Report a problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await dialog.getByLabel('What happened?').fill('Spam test');
  await dialog.getByLabel('Your email').fill('visitor@example.com');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Too many requests. Try again later.');
  await expect(dialog).toBeVisible();
});

test('the error screen offers "Tell us what happened" and includes the error that just happened', async ({ page }) => {
  const sent = await mockApi(page, { signedIn: true, crashJob: true });
  await page.goto('/jobseeker/jobs/job-1');
  await expect(page.getByRole('heading', { name: 'This screen missed a beat.' })).toBeVisible();
  await page.getByRole('button', { name: 'Tell us what happened' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/recent error message/)).toBeVisible();
  await dialog.getByLabel('What happened?').fill('The job page crashed.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks, we have your report' })).toBeVisible();
  expect(sent[0].body).toContain('"errors"');
});

test('"Capture this page" turns the shared tab into a preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Phones cannot capture the screen.');
  await page.addInitScript(() => {
    // A stand-in for the browser's screen-share prompt: a canvas stream.
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#7c3aed';
      context.fillRect(0, 0, 320, 200);
      setInterval(() => context.fillRect(0, 0, 320, 200), 50);
      return canvas.captureStream(20);
    };
  });
  const sent = await mockApi(page, { signedIn: true });
  await page.goto('/jobseeker');
  await page.getByRole('button', { name: /Open account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Report a problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem' });
  await dialog.getByLabel('What happened?').fill('Layout is broken.');
  await dialog.getByRole('button', { name: 'Capture this page' }).click();
  await expect(dialog.getByRole('img', { name: 'Preview of your screenshot' })).toBeVisible();
  await expect(dialog.getByLabel('What happened?')).toHaveValue('Layout is broken.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('dialog', { name: 'Thanks, we have your report' })).toBeVisible();
  expect(sent[0].body).toContain('filename="page.jpg"');
});
