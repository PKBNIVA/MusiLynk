import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock-api';

// WhatsApp share buttons (ShareMenu): presence on public pages, absence on demo content, the exact
// wa.me message (decoded) with UTM params, copy-link toast, and a booking share that carries no
// fee, phone number or email.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const professional = {
  id: 'm1',
  name: 'Meera Iyer',
  role: 'jobseeker',
  headline: 'Carnatic violinist',
  location: 'Chennai',
  bio: 'Violinist for weddings and concerts.',
  genres: ['Carnatic'],
  demo: false,
};
const job = {
  id: 'j1',
  employer_id: 'e1',
  title: 'Wedding sangeet band',
  company: 'Shaadi Beats',
  location: 'Jaipur',
  description: 'Need a five-piece band.',
  skills: [],
  languages: [],
  screening_questions: [],
  status: 'published',
  demo: false,
};
const act = {
  id: 'a1',
  name: 'The Night Owls',
  act_type: 'band',
  bio: 'Live band',
  members: [],
  genres: [],
  demo: false,
};

const hirer = {
  id: 'e1',
  name: 'Shaadi Beats',
  email: 'hirer@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};
const musician = {
  id: 'qa-m',
  name: 'QA Musician',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

function decodedWhatsappUrl(href: string | null) {
  expect(href).toMatch(/^https:\/\/wa\.me\/\?text=/);
  return decodeURIComponent(href!.split('text=')[1]);
}

async function openMenu(page: Page, testId: string) {
  await page.getByTestId(testId).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

test('public profile shares to WhatsApp with the canonical link and UTM params', async ({ page }) => {
  await mockApi(page, { '/api/public/talent/m1': { body: { professional, portfolio: [] } } });
  await page.goto('/professionals/m1');
  await openMenu(page, 'share-profile');
  const item = page.getByTestId('share-profile-whatsapp');
  await expect(item).toHaveAttribute('target', '_blank');
  const text = decodedWhatsappUrl(await item.getAttribute('href'));
  expect(text).toContain('Meera Iyer');
  expect(text).toContain('Carnatic violinist');
  const link = new URL(text.match(/https?:\/\/\S+/)![0]);
  expect(link.pathname).toBe('/professionals/m1');
  expect(link.searchParams.get('utm_source')).toBe('whatsapp');
  expect(link.searchParams.get('utm_medium')).toBe('share');
  expect(link.searchParams.get('utm_campaign')).toBe('professional');
});

test('a demo profile and a demo act show no share button', async ({ page }) => {
  await mockApi(page, {
    '/api/public/talent/m1': { body: { professional: { ...professional, demo: true }, portfolio: [] } },
    '/api/public/acts/a1': { body: { act: { ...act, demo: true } } },
  });
  await page.goto('/professionals/m1');
  await expect(page.getByRole('heading', { name: 'Meera Iyer' })).toBeVisible();
  await expect(page.getByTestId('share-profile')).toHaveCount(0);
  await page.goto('/acts/a1');
  await expect(page.getByRole('heading', { name: 'The Night Owls' })).toBeVisible();
  await expect(page.getByTestId('share-act')).toHaveCount(0);
});

test('public opportunity and act pages offer the share menu', async ({ page }) => {
  await mockApi(page, { '/api/jobs/j1': { body: { job } }, '/api/public/acts/a1': { body: { act } } });
  await page.goto('/opportunities/j1');
  await openMenu(page, 'share-opportunity');
  const text = decodedWhatsappUrl(await page.getByTestId('share-opportunity-whatsapp').getAttribute('href'));
  expect(text).toContain('Wedding sangeet band at Shaadi Beats, Jaipur');
  expect(text).toContain('utm_campaign=opportunity');
  await page.keyboard.press('Escape');
  await page.goto('/acts/a1');
  await openMenu(page, 'share-act');
  expect(decodedWhatsappUrl(await page.getByTestId('share-act-whatsapp').getAttribute('href'))).toContain(
    'utm_campaign=act',
  );
});

test('copy link shows a toast and uses the canonical URL; share_clicked is tracked', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  const events: Array<{ name: string; props: Record<string, unknown> }> = [];
  await mockApi(page, { '/api/public/talent/m1': { body: { professional, portfolio: [] } } });
  await page.route('**/api/events', async (route) => {
    events.push(...(route.request().postDataJSON() as { events: typeof events }).events);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/professionals/m1');
  await openMenu(page, 'share-profile');
  await page.getByTestId('share-profile-copy').click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (copied) expect(copied).toContain('/professionals/m1?utm_source=copy&utm_medium=share&utm_campaign=professional');
  await expect
    .poll(() => events.find((e) => e.name === 'share_clicked')?.props, { timeout: 15_000 })
    .toMatchObject({ surface: 'professional', channel: 'copy' });
});

test('"More…" appears only where the browser has a native share sheet', async ({ page }) => {
  await mockApi(page, { '/api/public/talent/m1': { body: { professional, portfolio: [] } } });
  await page.goto('/professionals/m1');
  await openMenu(page, 'share-profile');
  if (await page.evaluate(() => 'share' in navigator))
    await expect(page.getByTestId('share-profile-native')).toBeVisible();
  else await expect(page.getByTestId('share-profile-native')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.addInitScript(() => {
    (navigator as unknown as { share: () => Promise<void> }).share = () => Promise.resolve();
  });
  await page.reload();
  await openMenu(page, 'share-profile');
  await expect(page.getByTestId('share-profile-native')).toBeVisible();
  await expect(page.getByTestId('share-profile-whatsapp')).toBeVisible();
});

test('the share menu fits a 360px screen without sideways scroll and has 40px targets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockApi(page, { '/api/public/talent/m1': { body: { professional, portfolio: [] } } });
  await page.goto('/professionals/m1');
  await openMenu(page, 'share-profile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByTestId('share-profile-whatsapp').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  const trigger = await page.getByTestId('share-profile').boundingBox();
  expect(trigger!.height).toBeGreaterThanOrEqual(40);
});

test('the hirer sees share on their published opportunity', async ({ page }) => {
  await mockApi(page, { '/api/jobs/j1': { body: { job } } }, hirer);
  await page.goto('/employer/jobs/j1');
  await openMenu(page, 'share-hirer-opportunity');
  const text = decodedWhatsappUrl(await page.getByTestId('share-hirer-opportunity-whatsapp').getAttribute('href'));
  expect(text).toContain('We are hiring on MusiLynk: Wedding sangeet band');
  expect(text).toContain('utm_campaign=hirer_opportunity');
});

test('a confirmed booking share has date, city and act but no fee, phone or email', async ({ page }) => {
  const booking = {
    id: 'b1',
    actName: 'The Night Owls',
    status: 'accepted',
    event_type: 'wedding',
    event_date: futureDate(40),
    city: 'Pune',
    venue_name: 'Lawn 7',
    venue_address: '12 MG Road, Pune. Call 9876543210',
    requirements: 'Email planner@example.invalid or call +91 98765 43210',
    requesterName: 'Asha Planner',
    isOwner: false,
    isRequester: true,
    latestQuote: {
      id: 'q1',
      total: 40000,
      performanceFee: 40000,
      currency: 'INR',
      depositPercent: 50,
      status: 'accepted',
    },
    latestQuoteTotal: 40000,
    paymentCount: 1,
    paidAmount: 20000,
    depositPaid: true,
    currency: 'INR',
    allowedTransitions: ['cancelled'],
  };
  await mockApi(
    page,
    { '/api/bookings': { body: { bookings: [booking] } }, '/api/bookings/b1/payments': { body: { payments: [] } } },
    musician,
  );
  await page.goto('/jobseeker/bookings');
  await openMenu(page, 'share-booking-b1');
  const text = decodedWhatsappUrl(await page.getByTestId('share-booking-b1-whatsapp').getAttribute('href'));
  expect(text).toContain('The Night Owls');
  expect(text).toContain('Pune');
  expect(text).toContain('/jobseeker/bookings');
  expect(text).toContain('utm_campaign=booking');
  expect(text).not.toMatch(/₹|40,?000|20,?000|INR|fee|deposit/i);
  expect(text).not.toMatch(/9876543210|98765 43210|@|Lawn 7|MG Road/);
});

test('an unconfirmed booking has no share button', async ({ page }) => {
  const booking = {
    id: 'b2',
    actName: 'The Night Owls',
    status: 'accepted',
    event_date: futureDate(40),
    city: 'Pune',
    requesterName: 'Asha Planner',
    isOwner: false,
    isRequester: true,
    paymentCount: 0,
    depositPaid: false,
    allowedTransitions: ['cancelled'],
  };
  await mockApi(page, { '/api/bookings': { body: { bookings: [booking] } } }, musician);
  await page.goto('/jobseeker/bookings');
  await expect(page.getByTestId('booking-card')).toBeVisible();
  await expect(page.getByTestId('share-booking-b2')).toHaveCount(0);
});
