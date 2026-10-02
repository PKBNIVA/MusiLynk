import { expect, test, type Page, type Route } from '@playwright/test';

// Mocked-API tests of the booking fee/GST breakdown and the cancellation rules shown on the
// quote and booking pages (checkout with the platform fee off and on). The real fee math and
// refund rules are covered by backend/test/integration/booking_fee_and_refunds_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const user = {
  id: 'qa-jobseeker',
  name: 'QA Musician',
  email: 'qa@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const feeOffPolicy = {
  feeEnabled: false,
  plainEnglish: ['MusiLynk does not currently charge a platform fee on bookings.'],
  policyVersion: 1,
};
const feeOnPolicy = {
  feeEnabled: true,
  plainEnglish: [
    "MusiLynk charges a platform fee of 10% of the quoted total, plus 18% GST on the fee. The fee is added to the hirer's deposit.",
    'If the hirer cancels more than 7 days before the event, the deposit is fully refunded.',
    'If the hirer cancels 2-7 days before the event, 50% of the deposit is refunded.',
    'If the hirer cancels within 2 days of the event, the deposit is not refunded.',
    'If the musician does not show up, the deposit is fully refunded and the platform fee is waived.',
    'If the hirer does not show up, the deposit is kept.',
  ],
  policyVersion: 1,
};

function quoteFor(policyOn: boolean) {
  return {
    id: 'q1',
    performanceFee: 40000,
    travelFee: 0,
    productionFee: 0,
    otherFee: 0,
    total: 40000,
    currency: 'INR',
    depositPercent: 50,
    validUntil: null,
    inclusions: '',
    exclusions: '',
    cancellationTerms: '',
    status: 'accepted',
    feeAmount: policyOn ? 4000 : 0,
    gstAmount: policyOn ? 720 : 0,
    feePercent: policyOn ? 10 : 0,
    policyVersion: 1,
  };
}

function bookingFor(policyOn: boolean, overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    actName: 'The Night Owls',
    status: 'accepted',
    event_type: 'wedding',
    event_date: futureDate(40),
    city: 'Pune',
    requesterName: 'QA Musician',
    isOwner: false,
    isRequester: true,
    latestQuote: quoteFor(policyOn),
    paymentCount: 0,
    depositPaid: false,
    currency: 'INR',
    allowedTransitions: ['cancelled', 'disputed'],
    bookingPolicy: policyOn ? feeOnPolicy : feeOffPolicy,
    ...overrides,
  };
}

async function openBookings(page: Page, policyOn: boolean, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-token'));
  await page.route('**/api/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname.endsWith('/me')) return json({ user });
    if (pathname === '/api/bookings') return json({ bookings: [bookingFor(policyOn, overrides)] });
    if (pathname === '/api/bookings/b1/payments') return json({ payments: [] });
    return json({});
  });
  await page.goto('/jobseeker/bookings');
}

test('checkout breakdown shows only the deposit when the platform fee is off', async ({ page }) => {
  await openBookings(page, false);
  const card = page.getByTestId('booking-card').filter({ hasText: 'The Night Owls' });
  const breakdown = card.getByTestId('booking-fee-breakdown').first();
  await expect(breakdown.getByTestId('breakdown-deposit')).toContainText('₹20,000');
  await expect(breakdown.getByTestId('breakdown-fee')).toHaveCount(0);
  await expect(breakdown.getByTestId('breakdown-gst')).toHaveCount(0);
  await expect(breakdown.getByTestId('breakdown-total')).toContainText('₹20,000');
  await expect(page.getByText('MusiLynk does not currently charge a platform fee on bookings.').first()).toBeVisible();
});

test('checkout breakdown shows the fee and GST on top of the deposit when the platform fee is on', async ({ page }) => {
  await openBookings(page, true);
  const card = page.getByTestId('booking-card').filter({ hasText: 'The Night Owls' });
  const breakdown = card.getByTestId('booking-fee-breakdown').first();
  await expect(breakdown.getByTestId('breakdown-deposit')).toContainText('₹20,000');
  await expect(breakdown.getByTestId('breakdown-fee')).toContainText('₹4,000');
  await expect(breakdown.getByTestId('breakdown-gst')).toContainText('₹720');
  await expect(breakdown.getByTestId('breakdown-total')).toContainText('₹24,720');
  await expect(page.getByRole('button', { name: /Pay deposit · ₹24,720/ })).toBeVisible();
});

test('cancellation and no-show rules are shown in plain words with a policy version', async ({ page }) => {
  await openBookings(page, true);
  const card = page.getByTestId('booking-card').filter({ hasText: 'The Night Owls' });
  const rules = card.getByTestId('cancellation-rules').first();
  await expect(rules).toContainText('fully refunded');
  await expect(rules).toContainText('musician does not show up');
  await expect(rules).toContainText('hirer does not show up');
  await expect(card.getByText('Policy version 1').first()).toBeVisible();
});

test('reporting a musician no-show sends the reason and shows the refund outcome', async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await openBookings(page, true, { depositPaid: true, allowedTransitions: ['disputed'] });
  await page.route('**/api/bookings/b1/status', async (route: Route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ok: true,
        status: 'disputed',
        refund: {
          id: 'r1',
          amount: 24720,
          currency: 'INR',
          refundPercent: 100,
          reason: 'musician_no_show',
          status: 'pending_manual',
          note: 'Full refund. Fee waived.',
        },
      },
    });
  });
  const card = page.getByTestId('booking-card').filter({ hasText: 'The Night Owls' });
  await card.getByRole('button', { name: 'Report musician no-show' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Report musician no-show' }).click();
  await expect(page.getByText('Full refund. Fee waived.')).toBeVisible();
  expect(sent).toEqual({ status: 'disputed', noShow: 'musician' });
});
