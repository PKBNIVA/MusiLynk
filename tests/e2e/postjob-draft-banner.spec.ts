import { expect, test, type Page, type Route } from '@playwright/test';

// A hirer with an unfinished draft opens the post-job wizard on a phone. The "unfinished draft"
// banner must wrap into a few readable lines (it used to collapse into a one-word-wide column),
// cause no horizontal scroll, and not shift the page when the draft lookup answers.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const employer = {
  id: 'qa-employer',
  name: 'QA Employer',
  email: 'employer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};
const draft = {
  id: 'job-draft',
  employer_id: 'qa-employer',
  title: 'Wedding sangeet band for a December weekend',
  status: 'draft',
  skills: [],
  languages: [],
  screeningQuestions: [],
};
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openWithDraft(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem('musilynk_access_token', 'qa-token');
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[])
        if (!entry.hadRecentInput) w.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/me') return json(route, { user: employer });
    if (path === '/notifications/unread') return json(route, { unread: 0 });
    if (path === '/ai/status') return json(route, { enabled: false, tasks: [] });
    if (path === '/jobs/limits')
      return json(route, { activeAllowed: 3, activeUsed: 1, plan: 'free', planName: 'Free' });
    if (path === '/employer/jobs') {
      await new Promise((r) => setTimeout(r, 600)); // a slow lookup, as on a phone connection
      return json(route, { jobs: [draft] });
    }
    if (path === '/me/identities') return json(route, { identities: [] });
    return json(route, { ok: true });
  });
  await page.goto('/employer/post-job');
}

for (const width of [360, 390]) {
  test(`the draft banner wraps readably and does not shift the page at ${width}px`, async ({ page }) => {
    await openWithDraft(page, width);
    const offer = page.getByTestId('draft-offer');
    await expect(offer).toContainText('Wedding sangeet band');
    await page.waitForTimeout(500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);

    const main = await page.locator('main').boundingBox();
    const box = await offer.boundingBox();
    expect(main && box).toBeTruthy();
    // The banner spans the content column rather than collapsing next to its buttons.
    expect(box!.width).toBeGreaterThan(main!.width - 40);
    const text = offer.locator('span').first();
    const textBox = await text.boundingBox();
    expect(textBox!.width).toBeGreaterThan(main!.width * 0.7);
    const lineHeight = await text.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20);
    expect(textBox!.height / lineHeight).toBeLessThan(9); // a few lines, not a one-word-per-line column

    for (const name of ['Continue draft', 'Start a new one']) {
      const button = await offer.getByRole('button', { name }).boundingBox();
      expect(button!.x + button!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
