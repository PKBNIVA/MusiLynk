import { expect, test } from '@playwright/test';

// The home hero photo is the LCP element. A 390 px phone at 3x pixel density needs about 1170 px,
// so it must be served the 1280 px file, never the 1600 px one; the img also reserves its box
// (width/height) and loads at high priority.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

test('a 390px phone at 3x density gets a hero no wider than 1280px', async ({ page }) => {
  const photoRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/img\/veena-concert-\d+\.webp/.test(request.url())) photoRequests.push(request.url());
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  const hero = page.locator('[data-testid="landing-hero"] img').first();
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.currentSrc)).toBeTruthy();

  const info = await hero.evaluate((img: HTMLImageElement) => ({
    currentSrc: img.currentSrc,
    srcset: img.srcset,
    width: img.getAttribute('width'),
    height: img.getAttribute('height'),
    priority: img.getAttribute('fetchpriority'),
    loading: img.getAttribute('loading'),
  }));
  const chosen = Number(/-(\d+)\.webp$/.exec(info.currentSrc)?.[1]);
  expect(chosen).toBeLessThanOrEqual(1280);
  expect(chosen).toBeGreaterThanOrEqual(960);
  for (const w of [640, 960, 1280, 1600]) expect(info.srcset).toContain(`-${w}.webp ${w}w`);
  expect(Number(info.width)).toBeGreaterThan(0);
  expect(Number(info.height)).toBeGreaterThan(0);
  expect(info.priority).toBe('high');
  expect(info.loading).toBe('eager');
  expect(photoRequests.some((url) => url.endsWith('-1600.webp'))).toBe(false);
});

test.describe('360px at 2x', () => {
  test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  test('a 360px phone at 2x density gets a mid-size hero', async ({ page }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/');
    const hero = page.locator('[data-testid="landing-hero"] img').first();
    await expect(hero).toBeVisible();
    await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.currentSrc)).toBeTruthy();
    const src = await hero.evaluate((img: HTMLImageElement) => img.currentSrc);
    expect(Number(/-(\d+)\.webp$/.exec(src)?.[1])).toBeLessThanOrEqual(960);
  });
});
