import {expect, test, type Page, type Request} from '@playwright/test';

// Mocked-API checks for "Your data & account": data download and account deletion.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const me = {id: 'qa-leaver', name: 'Asha Rao', email: 'asha@example.invalid', role: 'jobseeker', status: 'active', profileComplete: true};

type Reply = {status?: number; body: unknown};

async function signIn(page: Page, handler: (request: Request, pathname: string) => Reply | undefined) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Seed the session on the first load only, so a reload after deletion shows the real signed-out state.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let reply = handler(request, pathname);
    if (!reply && pathname.endsWith('/me')) reply = {body: {user: me}};
    reply ??= {body: {}};
    return route.fulfill({status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.body)});
  });
  return errors;
}

test('download my data saves the export as a JSON file', async ({page}) => {
  const errors = await signIn(page, (_r, path) =>
    path === '/api/account/export' ? {body: {format: 'verse-account-export', account: {email: me.email}}} : undefined,
  );
  await page.goto('/jobseeker/account');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download my data'}).click();
  expect((await download).suggestedFilename()).toMatch(/^verse-data-\d{4}-\d{2}-\d{2}\.json$/);
  expect(errors).toEqual([]);
});

test('delete stays disabled until the email matches, shows refusals, then signs out', async ({page}) => {
  let refuse = true;
  let sentBody: unknown;
  const errors = await signIn(page, (request, path) => {
    if (path !== '/api/account' || request.method() !== 'DELETE') return undefined;
    sentBody = request.postDataJSON();
    if (refuse) return {status: 409, body: {error: 'Cancel your paid plan on the Plan & billing page before deleting your account.', code: 'SUBSCRIPTION_ACTIVE'}};
    return {body: {deleted: true}};
  });
  await page.goto('/jobseeker/account');
  const button = page.getByRole('button', {name: 'Delete my account'});
  const confirm = page.getByLabel('Type your account email to confirm');

  await expect(button).toBeDisabled();
  await confirm.fill('someone@example.invalid');
  await expect(button).toBeDisabled();
  await confirm.fill('ASHA@example.invalid');
  await expect(button).toBeEnabled();

  await button.click();
  await expect(page.getByRole('alert')).toContainText('Cancel your paid plan');
  expect(sentBody).toEqual({confirmEmail: 'ASHA@example.invalid'});

  refuse = false;
  await button.click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('verse_access_token'))).toBeNull();
  expect(errors).toEqual([]);
});
