import { expect, test, type Page, type Request } from '@playwright/test';

// Mocked-API coverage for musician actions that used to fire immediately (remove availability,
// hide an act from booking, un-save an opportunity) and for the emailed one-click cancel link.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const me = {
  id: 'qa-seeker',
  name: 'Asha Rao',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

type Reply = { status?: number; body: unknown };
type Handler = (request: Request, pathname: string) => Reply | undefined;

async function signIn(page: Page, handler: Handler) {
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
  });
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let reply = handler(request, pathname);
    if (!reply && pathname.endsWith('/me')) reply = { body: { user: me } };
    reply ??= { body: {} };
    return route.fulfill({
      status: reply.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(reply.body),
    });
  });
}

test('removing availability asks first and only deletes on confirm', async ({ page }) => {
  const deletes: string[] = [];
  await signIn(page, (request, path) => {
    if (path === '/api/availability' && request.method() === 'GET')
      return {
        body: {
          windows: [{ id: 'w1', status: 'available', startAt: '2030-01-10T10:00:00Z', endAt: '2030-01-10T12:00:00Z' }],
        },
      };
    if (request.method() === 'DELETE') {
      deletes.push(path);
      return { body: { ok: true } };
    }
    return undefined;
  });
  await page.goto('/jobseeker/availability');
  await page.getByRole('button', { name: 'Remove availability' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Hirers will no longer see this window');
  await dialog.getByRole('button', { name: 'Keep as is' }).click();
  expect(deletes).toEqual([]);
  await expect(page.getByRole('button', { name: 'Remove availability' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove availability' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove availability' }).click();
  await expect(page.getByRole('button', { name: 'Remove availability' })).toHaveCount(0);
  expect(deletes).toEqual(['/api/availability/w1']);
});

test('hiding an act from booking asks first and only deletes on confirm', async ({ page }) => {
  const deletes: string[] = [];
  await signIn(page, (request, path) => {
    if (path === '/api/acts/me')
      return { body: { acts: [{ id: 'a1', name: 'The Late Set', status: 'active', members: [] }] } };
    if (request.method() === 'DELETE') {
      deletes.push(path);
      return { body: { ok: true } };
    }
    return undefined;
  });
  await page.goto('/jobseeker/acts');
  await page.getByRole('button', { name: 'Hide from booking' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('The Late Set');
  await expect(dialog).toContainText('no longer find this act');
  await dialog.getByRole('button', { name: 'Keep as is' }).click();
  expect(deletes).toEqual([]);
  await page.getByRole('button', { name: 'Hide from booking' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hide from booking' }).click();
  await expect.poll(() => deletes).toEqual(['/api/acts/a1']);
});

test('un-saving an opportunity offers an undo that saves it again', async ({ page }) => {
  const calls: string[] = [];
  const job = {
    id: 's1',
    title: 'Session Guitarist',
    company: 'Verse Studio',
    location: 'Mumbai',
    workplace: 'onsite',
    opportunity_kind: 'gig',
  };
  let saved = true;
  await signIn(page, (request, path) => {
    if (path === '/api/saved-jobs') return { body: { jobs: saved ? [job] : [] } };
    if (path === '/api/saved-jobs/s1') {
      calls.push(request.method());
      saved = request.method() === 'POST';
      return { body: { ok: true } };
    }
    return undefined;
  });
  await page.goto('/jobseeker/saved');
  await page.getByRole('button', { name: 'Remove Session Guitarist from saved' }).click();
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Session Guitarist' })).toBeVisible();
  expect(calls).toEqual(['DELETE', 'POST']);
});

test.describe('one-click cancel link on musician billing', () => {
  test('opens the confirmation, cleans the URL, and cancels only on confirm', async ({ page }) => {
    const calls: string[] = [];
    await signIn(page, (request, path) => {
      if (path === '/api/billing/cancel-link') {
        calls.push(`verify ${new URL(request.url()).searchParams.get('t')}`);
        return { body: { ok: true, subscriptionId: 'sub1' } };
      }
      if (path === '/api/billing/cancel') {
        calls.push('cancel');
        return { body: { ok: true, outcome: 'cancelled' } };
      }
      return undefined;
    });
    await page.goto('/jobseeker/billing?cancel=1&t=tok%2B123');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Cancel your subscription?');
    await expect(page).toHaveURL(/\/jobseeker\/billing$/);
    expect(calls).toEqual(['verify tok+123']);
    await dialog.getByRole('button', { name: 'Keep subscription' }).click();
    expect(calls).toEqual(['verify tok+123']);
    await expect(dialog).toHaveCount(0);
  });

  test('confirming sends the cancellation', async ({ page }) => {
    const calls: string[] = [];
    await signIn(page, (_r, path) => {
      if (path === '/api/billing/cancel-link') return { body: { ok: true } };
      if (path === '/api/billing/cancel') {
        calls.push('cancel');
        return { body: { ok: true, outcome: 'cancelled' } };
      }
      return undefined;
    });
    await page.goto('/jobseeker/billing?cancel=1&t=abc');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel subscription' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(calls).toEqual(['cancel']);
  });

  test('an invalid link shows no dialog, explains, and still cleans the URL', async ({ page }) => {
    await signIn(page, (_r, path) =>
      path === '/api/billing/cancel-link'
        ? { status: 404, body: { error: 'This cancel link is invalid.' } }
        : undefined,
    );
    await page.goto('/jobseeker/billing?cancel=1&t=bad');
    await expect(page.getByText('This cancel link is invalid or has expired')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/jobseeker\/billing$/);
  });
});

test('opportunity detail fits a phone with a long title, pay line and share action', async ({ page }) => {
  const long = 'House band audition for the supper club on the terrace of the Taj Lands End Bandra Mumbai';
  const similar = [1, 2, 3].map((n) => ({
    id: `s${n}`,
    title: `Bassist for a house rhythm section at the Saffron Terrace Hotel number ${n}`,
    company: 'Saffron Terrace Hotel',
    location: 'Navi Mumbai',
    workplace: 'onsite',
    opportunity_kind: 'gig',
    genre: 'Jazz',
    salary_min: 20000,
    salary_max: 30000,
    skills: ['Funk', 'Performance'],
  }));
  await signIn(page, (_r, path) =>
    path === '/api/jobs'
      ? { body: { jobs: similar } }
      : path === '/api/jobs/j1'
        ? {
            body: {
              job: {
                id: 'j1',
                title: long,
                company: 'Stagecraft-Collective-Entertainment-Productions-Private-Limited',
                location: 'Mumbai',
                workplace: 'onsite',
                type: 'Contract',
                opportunity_kind: 'audition',
                salary_min: 25000,
                salary_max: 40000,
                description:
                  'Weekly house band. https://example.com/a/very/long/unbroken/link/that/should/wrap/not/overflow/ok',
                skills: ['Guitar', 'Bass'],
                screeningQuestions: ['Which standards do you bring to the audition and how long have you played them?'],
                saved: false,
                isDemo: true,
              },
            },
          }
        : undefined,
  );
  await page.goto('/jobseeker/jobs/j1');
  await expect(page.getByRole('heading', { name: long })).toBeVisible();
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(
    (w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w,
    width,
  );
  const wide = await page.evaluate(
    (w) =>
      [...document.querySelectorAll('main *')]
        .filter((el) => el.getBoundingClientRect().right > w + 1)
        .slice(0, 5)
        .map(
          (el) =>
            `${el.tagName}.${String(el.className).slice(0, 60)} ${(el.textContent || '').slice(0, 40)} ${Math.round(el.getBoundingClientRect().right)}`,
        ),
    width,
  );
  expect(wide, 'elements wider than the viewport').toEqual([]);
  expect(overflow, 'job detail overflows horizontally').toBeLessThanOrEqual(1);
});

test('find talent with every filter group open fits a phone', async ({ page }) => {
  await signIn(page, (_r, path) => (path === '/api/candidates' ? { body: { candidates: [], meta: {} } } : undefined));
  await page.goto('/jobseeker/hiring/talent');
  await page.getByRole('button', { name: /more filters/i }).click();
  const width = page.viewportSize()!.width;
  const overflow = await page.evaluate(
    (w) => Math.max(document.documentElement.scrollWidth, window.innerWidth) - w,
    width,
  );
  expect(overflow, 'find talent overflows horizontally').toBeLessThanOrEqual(1);
});
