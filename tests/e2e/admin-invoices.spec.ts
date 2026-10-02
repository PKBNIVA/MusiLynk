import { expect, test } from '@playwright/test';

// Mocked-API test of the admin invoice views: the seller-details warning, the date-range CSV export, and
// an account's read-only billing details. The endpoints are covered by
// backend/test/integration/subscription_invoices_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const admin = {
  id: 'qa-admin',
  name: 'QA Admin',
  email: 'admin@example.invalid',
  role: 'admin',
  status: 'active',
  profileComplete: true,
};
const invoice = {
  id: 'tax_1',
  invoiceNumber: 'VRS/2026-27/000001',
  issuedAt: '2026-10-02T06:30:00Z',
  documentType: 'tax_invoice',
  totalPaise: 249900,
  currency: 'INR',
  buyerName: 'Kapoor Events LLP',
  refunded: false,
  refundReference: null,
  email: 'meera@example.invalid',
};

test('commerce shows invoices with the seller warning and exports a CSV for the chosen dates; users show billing read-only', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.addInitScript(() => localStorage.setItem('verse_access_token', 'qa-admin-token'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    requested.push(url.pathname + url.search);
    if (url.pathname.endsWith('/me')) return json({ user: admin });
    if (url.pathname === '/api/admin/invoices')
      return json({
        invoices: [invoice],
        sellerPending: ['business.legal_name', 'business.pan'],
        page: 1,
        perPage: 20,
        total: 1,
      });
    if (url.pathname === '/api/admin/invoices/export.csv')
      return route.fulfill({ status: 200, contentType: 'text/csv', body: 'invoice_number\n"VRS/2026-27/000001"\n' });
    if (url.pathname === '/api/admin/users')
      return json({
        users: [
          {
            id: 'u-1',
            name: 'Meera Kapoor',
            email: 'meera@example.invalid',
            role: 'employer',
            status: 'active',
            createdAt: '2026-09-01T00:00:00Z',
          },
        ],
        page: 1,
        perPage: 50,
        total: 1,
      });
    if (url.pathname === '/api/admin/users/u-1/billing')
      return json({
        profile: {
          buyerType: 'business',
          legalName: 'Kapoor Events LLP',
          gstin: '27AAPFU0939F1ZV',
          pan: '',
          addressLine1: '12 Linking Road',
          addressLine2: '',
          city: 'Mumbai',
          stateCode: '27',
          state: 'Maharashtra',
          postalCode: '400050',
          billingEmail: 'accounts@kapoor.example',
          poReference: 'PO-42',
          version: 2,
        },
        versions: [{ version: 2 }, { version: 1 }],
        invoices: [invoice],
      });
    return json({});
  });
  await page.goto('/admin');

  await page.getByRole('tab', { name: 'Commerce' }).click();
  const panel = page.getByTestId('admin-invoices');
  await expect(panel).toContainText('VRS/2026-27/000001');
  await expect(panel).toContainText('₹2,499.00');
  await expect(panel.getByTestId('invoice-seller-pending')).toContainText('business.legal_name, business.pan');
  await panel.getByLabel('From').fill('2026-10-01');
  await panel.getByLabel('To').fill('2026-10-31');
  await panel.getByRole('button', { name: 'Export invoices CSV' }).click();
  await expect
    .poll(() => requested.some((r) => r === '/api/admin/invoices/export.csv?from=2026-10-01&to=2026-10-31'))
    .toBe(true);

  await page.getByRole('tab', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Billing' }).click();
  const dialog = page.getByTestId('user-billing-dialog');
  await expect(dialog.getByTestId('user-billing-profile')).toContainText('Kapoor Events LLP');
  await expect(dialog.getByTestId('user-billing-profile')).toContainText('GSTIN 27AAPFU0939F1ZV');
  await expect(dialog.getByTestId('user-billing-profile')).toContainText('version 2 of 2');
  await expect(dialog.getByTestId('user-billing-invoices')).toContainText('VRS/2026-27/000001');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
});
