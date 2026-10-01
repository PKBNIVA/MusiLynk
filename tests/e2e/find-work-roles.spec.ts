import { expect, test } from '@playwright/test';

// Find work starts from all of the musician's roles (one request, roles OR-ed by the API) and
// each role is a chip that can be removed and added back. The OR matching itself is covered by
// backend/test/integration/search_filters_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const me = {
  id: 'qa-seeker',
  name: 'Asha Rao',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
  location: 'Pune',
  roles: ['Drummer', 'Vocalist', 'Sound engineer'],
};

test('Find work pre-selects every role as a removable chip and sends them together', async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('verse_access_token', 'qa-token');
    localStorage.setItem('verse-tour-v2-jobseeker', 'done');
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/me')) return reply({ user: me });
    if (!url.pathname.endsWith('/api/jobs')) return reply({});
    queries.push(url.searchParams);
    return reply({ jobs: [], nextCursor: null, total: 0 });
  });

  await page.goto('/jobseeker/jobs');
  const group = page.getByRole('group', { name: 'Your roles' });
  for (const role of me.roles)
    await expect(group.getByRole('button', { name: new RegExp(`^${role}`) })).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/roles=Drummer%2CVocalist%2CSound\+engineer/);
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  expect(queries.every((q) => q.get('roles') === 'Drummer,Vocalist,Sound engineer')).toBe(true);
  expect(queries.every((q) => !q.get('q'))).toBe(true);
  expect(queries).toHaveLength(1);

  await group.getByRole('button', { name: /^Drummer/ }).click();
  await expect(group.getByRole('button', { name: /^Drummer/ })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => queries.at(-1)?.get('roles')).toBe('Vocalist,Sound engineer');

  await group.getByRole('button', { name: /^Drummer/ }).click();
  await expect.poll(() => queries.at(-1)?.get('roles')).toBe('Vocalist,Sound engineer,Drummer');

  for (const role of ['Vocalist', 'Sound engineer', 'Drummer'])
    await group.getByRole('button', { name: new RegExp(`^${role}`) }).click();
  await expect.poll(() => queries.at(-1)?.has('roles')).toBe(false);
});
