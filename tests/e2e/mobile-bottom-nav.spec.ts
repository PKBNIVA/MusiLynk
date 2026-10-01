import { devices, expect, test, type Page } from '@playwright/test';

// The fixed bottom "Quick navigation" bar must never cover the last controls of a signed-in page.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');
test.use({ viewport: devices['Pixel 7'].viewport, isMobile: true, hasTouch: true });

type Role = 'jobseeker' | 'employer';
const user = (role: Role) => ({
  id: `qa-${role}`,
  name: 'QA User',
  email: 'qa@example.invalid',
  role,
  status: 'active',
  profileComplete: true,
});

async function signIn(page: Page, role: Role) {
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    for (const key of ['verse-tour-v2-jobseeker', 'verse-tour-v2-employer']) localStorage.setItem(key, 'done');
  });
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith('/me') ? { user: user(role) } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const pages: Array<[Role, string]> = [
  ['jobseeker', '/jobseeker/library'],
  ['jobseeker', '/jobseeker/profile'],
  ['jobseeker', '/jobseeker/alerts'],
  ['jobseeker', '/jobseeker/availability'],
  ['employer', '/employer/profile'],
  ['employer', '/employer/post-job'],
  ['employer', '/employer/workspace'],
];

for (const [role, path] of pages) {
  test(`the bottom navigation does not cover the last control on ${path}`, async ({ page }) => {
    await signIn(page, role);
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Make the page long enough to reach the bar, ending in a control, like any content-rich page.
    const covered = await page.evaluate(async () => {
      const main = document.querySelector('main')!;
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      const last = document.createElement('button');
      last.textContent = 'Last control';
      last.style.minHeight = '44px'; // a real touch target
      const after = document.createElement('div');
      after.style.height = '2000px';
      main.append(spacer, last, after);
      // Browsers scroll a control only just into view on focus, validation errors and taps;
      // with a fixed bottom bar that lands it underneath unless scroll padding reserves room.
      last.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nav = document.querySelector('nav[aria-label="Quick navigation"]')!;
      const box = last.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return nav.contains(hit) ? 'Last control' : null;
    });
    expect(covered, `"${covered}" sits under the bottom navigation`).toBeNull();
  });
}

// Scrolled all the way down, no visible control may sit under the bar (CRAWL-01: body used to be
// viewport-tall, so its bottom padding never added scroll room and Save buttons ended up covered).
const signedInPages: Array<[Role, string]> = [
  ...(
    [
      '',
      '/profile',
      '/portfolio',
      '/applications',
      '/jobs',
      '/saved',
      '/alerts',
      '/jobs/job-1',
      '/messages',
      '/notifications',
      '/resources',
      '/reviews',
      '/acts',
      '/book-talent',
      '/bookings',
      '/band-builder',
      '/urgent',
      '/availability',
      '/hiring/post',
      '/hiring/talent',
      '/compare',
      '/build-my-crew',
      '/hiring/applicants',
      '/billing',
      '/account',
      '/workspace',
    ] as const
  ).map((path): [Role, string] => ['jobseeker', `/jobseeker${path}`]),
  ...(
    [
      '',
      '/profile',
      '/post-job',
      '/candidates',
      '/compare',
      '/build-my-crew',
      '/applications',
      '/jobs/job-1',
      '/messages',
      '/notifications',
      '/acts',
      '/book-talent',
      '/bookings',
      '/band-builder',
      '/urgent',
      '/availability',
      '/billing',
      '/account',
      '/workspace',
    ] as const
  ).map((path): [Role, string] => ['employer', `/employer${path}`]),
];

for (const viewport of [
  { name: 'phone 390x844', size: { width: 390, height: 844 }, isMobile: true },
  { name: 'tablet 768x1024', size: { width: 768, height: 1024 }, isMobile: false },
]) {
  test.describe(`scrolled to the end on a ${viewport.name}`, () => {
    test.use({ viewport: viewport.size, isMobile: viewport.isMobile, hasTouch: true });
    for (const [role, path] of signedInPages) {
      test(`no control is under the bottom navigation on ${path}`, async ({ page }) => {
        await signIn(page, role);
        await page.goto(path);
        const nav = page.getByRole('navigation', { name: 'Quick navigation' });
        await expect(nav).toBeVisible();
        await page.waitForLoadState('networkidle');
        const result = await page.evaluate(async () => {
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const bar = document.querySelector('nav[aria-label="Quick navigation"]')!;
          const barTop = bar.getBoundingClientRect().top;
          const controls = [
            ...document.querySelectorAll<HTMLElement>(
              'main a[href], main button, main input:not([type=hidden]), main select, main textarea, main [role=button]',
            ),
          ].filter((element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== 'hidden' &&
              element.getAttribute('aria-hidden') !== 'true' &&
              box.bottom > 0 &&
              box.top < innerHeight
            );
          });
          const covered = controls
            .filter((element) => {
              const box = element.getBoundingClientRect();
              const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
              return bar.contains(hit) || box.bottom > barTop + 1;
            })
            .map((element) =>
              (element.innerText || element.getAttribute('aria-label') || element.id || element.tagName).trim(),
            );
          const lowest = Math.max(0, ...controls.map((element) => element.getBoundingClientRect().bottom));
          return { covered, lowest: Math.round(lowest), barTop: Math.round(barTop), count: controls.length };
        });
        expect(result.covered, `controls under the bar (bar top ${result.barTop}px)`).toEqual([]);
        expect(result.lowest).toBeLessThanOrEqual(result.barTop);
      });
    }
  });
}
