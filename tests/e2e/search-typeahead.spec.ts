import { expect, test, type Page } from '@playwright/test';

// R3 type-ahead (GET /api/search/suggest) on the search page's box (every device) and the header's
// quick search (desktop): debounced lookups, keyboard navigation, taps, and where a pick goes.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const SUGGESTIONS = [
  { kind: 'role', label: 'Tabla player', query: 'Tabla player' },
  { kind: 'instrument', label: 'Tabla', query: 'Tabla' },
  { kind: 'name', label: 'Tabassum Ali', detail: 'Singer from Pune', url: '/professionals/pro-1' },
];

async function mockApi(page: Page) {
  const suggestCalls: string[] = [];
  const searches: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const reply = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/api/me')) return reply(401, { error: 'Sign in' });
    if (url.pathname.endsWith('/api/search/suggest')) {
      const q = url.searchParams.get('q') || '';
      suggestCalls.push(q);
      return reply(200, { suggestions: q.toLowerCase().startsWith('tab') ? SUGGESTIONS : [] });
    }
    if (url.pathname.endsWith('/api/search')) {
      searches.push(url.searchParams.get('q') || '');
      return reply(200, { results: [], interpretedAs: [url.searchParams.get('q')], totals: {}, moreOf: {} });
    }
    return reply(200, {});
  });
  return { suggestCalls, searches };
}

test('the search page suggests as you type, once per pause, and the keyboard picks a term', async ({ page }) => {
  const { suggestCalls, searches } = await mockApi(page);
  await page.goto('/search');
  const box = page.getByRole('combobox', { name: 'Search MusiLynk' });
  await box.click();
  await box.pressSequentially('tab', { delay: 40 });
  const list = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(list.getByRole('option')).toHaveText([
    /Tabla player\s*Role/,
    /Tabla\s*Instrument/,
    /Tabassum Ali.*Musician/,
  ]);
  expect(suggestCalls).toEqual(['tab']);
  await expect(box).toHaveAttribute('aria-expanded', 'true');

  await box.press('ArrowDown');
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await box.press('ArrowDown');
  await box.press('ArrowUp');
  const firstId = (await list.getByRole('option').first().getAttribute('id')) ?? 'missing id';
  await expect(box).toHaveAttribute('aria-activedescendant', firstId);
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Tabla\+player$/);
  await expect.poll(() => searches.at(-1)).toBe('Tabla player');
  await expect(list).toBeHidden();

  await box.fill('tab');
  await expect(list).toBeVisible();
  await box.press('Escape');
  await expect(list).toBeHidden();
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=tab$/);
});

test('picking a person opens their profile; a tap works on touch screens', async ({ page, hasTouch }) => {
  await mockApi(page);
  await page.goto('/search');
  const box = page.getByRole('combobox', { name: 'Search MusiLynk' });
  await box.fill('taba');
  const person = page.getByRole('option', { name: /Tabassum Ali/ });
  await expect(person).toBeVisible();
  const option = await person.boundingBox();
  expect(option!.height).toBeGreaterThanOrEqual(44);
  if (hasTouch) await person.tap();
  else await person.click();
  await expect(page).toHaveURL(/\/professionals\/pro-1$/);
});

test('one or two letters ask nothing; nothing typed shows no list', async ({ page }) => {
  const { suggestCalls } = await mockApi(page);
  await page.goto('/search');
  const box = page.getByRole('combobox', { name: 'Search MusiLynk' });
  await box.fill('t');
  await page.waitForTimeout(400);
  expect(suggestCalls).toEqual([]);
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('the header quick search suggests too', async ({ page }) => {
  // The header box is desktop-only (`hidden lg:block`); phones use the search page's box above.
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page);
  await page.goto('/pricing');
  const box = page.getByRole('combobox', { name: 'Search jobs, people and acts' });
  await box.fill('tab');
  await expect(page.getByRole('option')).toHaveCount(3);
  await box.press('ArrowDown');
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Tabla$/);
});
