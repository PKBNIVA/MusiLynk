import { expect, test } from '@playwright/test';
import { fixtureTalent, fixtureActs } from './qa-helpers';

// Uploaded images arrive with their generated variants (backend ImageSet) and render as a <picture>
// sized for their placement: a talent card's 56 px avatar on a phone (390 px at 3x) must fetch the
// 320 px variant, never the 768/1600 px copy or the original, and reserve its box so nothing shifts.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const MEDIA = 'https://media.example.test/uploads/qa';
// A 1x1 WebP, enough for the browser to count the request as a loaded image.
const WEBP_1PX = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

function imageSet(key: string) {
  const src = `${MEDIA}/${key}.jpg`;
  return {
    src,
    srcset: {
      avif: [320, 768, 1600].map((w) => `${src}/v/${w}.avif ${w}w`),
      webp: [320, 768, 1600].map((w) => `${src}/v/${w}.webp ${w}w`),
    },
    width: 1600,
    height: 1067,
  };
}

const talent = fixtureTalent.map((person, i) => ({
  ...person,
  demo: false,
  photoUrl: `${MEDIA}/face-${i}.jpg`,
  photo: imageSet(`face-${i}`),
}));
const acts = fixtureActs.map((act, i) => ({
  ...act,
  demo: false,
  photo_url: `${MEDIA}/cover-${i}.jpg`,
  photo: imageSet(`cover-${i}`),
}));

async function serveMedia(page: import('@playwright/test').Page) {
  const requested: string[] = [];
  await page.route(`${MEDIA}/**`, (route) => {
    requested.push(route.request().url());
    const url = route.request().url();
    const type = url.endsWith('.avif') ? 'image/avif' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return route.fulfill({ status: 200, contentType: type, body: WEBP_1PX });
  });
  return requested;
}

async function mockDirectory(page: import('@playwright/test').Page) {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/public/talent')) body = { talent, total: talent.length, nextCursor: null };
    else if (path.endsWith('/public/acts')) body = { acts, total: acts.length, nextCursor: null };
    else if (path === '/api/me') return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const widthOf = (url: string) => Number(/\/v\/(\d+)\.(?:avif|webp)$/.exec(url)?.[1] ?? 0);

test('a talent card avatar requests a variant no wider than 768 px and keeps its box', async ({ page }) => {
  const requested = await serveMedia(page);
  await mockDirectory(page);
  await page.goto('/music-professionals');
  const card = page.getByTestId('talent-card').first();
  await expect(card).toBeVisible();
  const img = card.locator('[data-testid=user-avatar] img').first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.currentSrc)).toBeTruthy();

  const info = await img.evaluate((el: HTMLImageElement) => ({
    currentSrc: el.currentSrc,
    width: el.getAttribute('width'),
    height: el.getAttribute('height'),
    loading: el.getAttribute('loading'),
    decoding: el.getAttribute('decoding'),
    sizes: el.parentElement?.querySelector('source')?.getAttribute('sizes') ?? '',
    types: [...(el.parentElement?.querySelectorAll('source') ?? [])].map((s) => s.getAttribute('type')),
    box: { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height },
  }));
  expect(info.types).toEqual(['image/avif', 'image/webp']);
  expect(info.sizes).toBe('56px');
  expect(info.width).toBe('56');
  expect(info.height).toBe('56');
  expect(info.decoding).toBe('async');
  expect(['lazy', 'eager']).toContain(info.loading);
  expect(Math.round(info.box.w)).toBe(56);
  expect(Math.round(info.box.h)).toBe(56);
  expect(info.currentSrc).toMatch(/\/v\/\d+\.(avif|webp)$/);
  expect(widthOf(info.currentSrc)).toBeLessThanOrEqual(768);

  // Every face fetched so far is a variant of at most 768 px; the originals are never downloaded.
  const faces = requested.filter((url) => url.includes('/face-'));
  expect(faces.length).toBeGreaterThan(0);
  for (const url of faces) {
    expect(url, 'variant, not the original').toMatch(/\/v\/\d+\.(avif|webp)$/);
    expect(widthOf(url)).toBeLessThanOrEqual(768);
  }
});

test('an act card cover is a <picture> with the card sizes, sized by the set so the layout does not shift', async ({
  page,
}) => {
  const requested = await serveMedia(page);
  await mockDirectory(page);
  await page.goto('/book-music');
  const cover = page.getByTestId('act-cover').first();
  await expect(cover).toBeVisible();
  const img = cover.locator('img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.currentSrc)).toBeTruthy();
  const info = await img.evaluate((el: HTMLImageElement) => ({
    currentSrc: el.currentSrc,
    width: el.getAttribute('width'),
    height: el.getAttribute('height'),
    sizes: el.parentElement?.querySelector('source')?.getAttribute('sizes') ?? '',
    coverHeight: el.closest('[data-testid=act-cover]')?.getBoundingClientRect().height,
  }));
  expect(info.sizes).toBe('(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw');
  expect(info.width).toBe('1600');
  expect(info.height).toBe('1067');
  expect(Math.round(info.coverHeight ?? 0)).toBe(112);
  expect(info.currentSrc).toMatch(/\/v\/\d+\.(avif|webp)$/);
  const covers = requested.filter((url) => url.includes('/cover-'));
  expect(covers.length).toBeGreaterThan(0);
  for (const url of covers) expect(url).toMatch(/\/v\/\d+\.(avif|webp)$/);
});
