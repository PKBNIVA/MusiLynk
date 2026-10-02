import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Handler, type Reply } from './mock-api';

// Billing details (individual or business, GSTIN checks), the invoice list, and the printable invoice
// for individual / business and intra- / inter-state buyers, on desktop and mobile. The API behind it
// is covered by backend/test/integration/subscription_invoices_test.rb.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

const hirer = {
  id: 'qa-hirer',
  name: 'Meera Kapoor',
  email: 'meera@example.invalid',
  role: 'employer',
  status: 'active',
  profileComplete: true,
};
const musician = {
  id: 'qa-musician',
  name: 'Asha Rao',
  email: 'asha@example.invalid',
  role: 'jobseeker',
  status: 'active',
  profileComplete: true,
};

const STATES = [
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '07', name: 'Delhi' },
];
const profileReply = (profile: unknown = null): Reply => ({
  body: { profile, states: STATES, defaults: { legalName: 'Meera Kapoor', billingEmail: 'meera@example.invalid' } },
});
const plans: Reply = {
  body: {
    annualAvailable: false,
    plans: [
      {
        code: 'free',
        name: 'Free',
        monthly: 0,
        annual: 0,
        trialDays: 0,
        activePosts: 1,
        seats: 1,
        shortlist: 20,
        bookings: 2,
      },
      {
        code: 'pro',
        name: 'Pro',
        monthly: 2499,
        annual: 24990,
        trialDays: 14,
        activePosts: 10,
        seats: 2,
        shortlist: 250,
        bookings: 20,
      },
    ],
  },
};

const seller = {
  legalName: 'Alien Brains Private Limited',
  address: '12 Linking Road, Bandra West, Mumbai 400050',
  state: 'Maharashtra',
  stateCode: '27',
  gstin: '27AAPFU0939F1ZV',
  pan: 'AAPFU0939F',
};
const line = {
  description: 'Verse Pro plan, monthly subscription',
  sacCode: '998314',
  taxableValuePaise: 211780,
  periodStart: '2026-10-02T06:30:00Z',
  periodEnd: '2026-11-01T06:30:00Z',
};
const words = 'Indian Rupees Two Thousand Four Hundred Ninety Nine Only';
const invoices = {
  b2cIntra: {
    id: 'tax_b2c',
    invoiceNumber: 'VRS/2026-27/000123',
    issuedAt: '2026-10-02T06:30:00Z',
    documentType: 'tax_invoice',
    seller,
    buyer: {
      type: 'individual',
      name: 'Meera Kapoor',
      addressLine1: '5 MG Road',
      city: 'Pune',
      postalCode: '411001',
      state: 'Maharashtra',
      stateCode: '27',
      email: 'meera@example.invalid',
    },
    lineItems: [line],
    placeOfSupply: { code: '27', name: 'Maharashtra' },
    taxableValuePaise: 211780,
    cgstPaise: 19060,
    sgstPaise: 19060,
    igstPaise: 0,
    totalPaise: 249900,
    ratePercent: 18,
    amountInWords: words,
    paymentReference: 'pay_QA1',
  },
  b2bInter: {
    id: 'tax_b2b',
    invoiceNumber: 'VRS/2026-27/000124',
    issuedAt: '2026-10-03T06:30:00Z',
    documentType: 'tax_invoice',
    seller,
    buyer: {
      type: 'business',
      name: 'Kapoor Events LLP With A Rather Long Registered Business Name Private',
      gstin: '29AAGCB7383J1Z4',
      addressLine1: '4 Residency Road, Shanthala Nagar, Ashok Nagar',
      city: 'Bengaluru',
      postalCode: '560025',
      state: 'Karnataka',
      stateCode: '29',
      email: 'accounts@kapoor.example',
      poReference: 'PO-2026/0042',
    },
    lineItems: [line],
    placeOfSupply: { code: '29', name: 'Karnataka' },
    taxableValuePaise: 211780,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 38120,
    totalPaise: 249900,
    ratePercent: 18,
    amountInWords: words,
    paymentReference: 'pay_QA2',
  },
  b2bIntra: {
    id: 'tax_b2b_intra',
    invoiceNumber: 'VRS/2026-27/000125',
    issuedAt: '2026-10-04T06:30:00Z',
    documentType: 'tax_invoice',
    seller,
    buyer: {
      type: 'business',
      name: 'Bandra Beats LLP',
      gstin: '27AAPFU0939F1ZV',
      addressLine1: '1 Hill Road',
      city: 'Mumbai',
      postalCode: '400050',
      state: 'Maharashtra',
      stateCode: '27',
      email: 'a@b.in',
    },
    lineItems: [line],
    placeOfSupply: { code: '27', name: 'Maharashtra' },
    taxableValuePaise: 211780,
    cgstPaise: 19060,
    sgstPaise: 19060,
    igstPaise: 0,
    totalPaise: 249900,
    ratePercent: 18,
    amountInWords: words,
    paymentReference: 'pay_QA3',
  },
  billOfSupply: {
    id: 'tax_bos_1',
    invoiceNumber: 'VRS/2026-27/000126',
    issuedAt: '2026-10-05T06:30:00Z',
    documentType: 'bill_of_supply',
    seller: {
      legalName: 'Alien Brains Private Limited',
      address: '12 Linking Road, Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
    },
    buyer: { type: 'individual', name: 'Meera Kapoor', email: 'meera@example.invalid' },
    lineItems: [{ ...line, taxableValuePaise: 249900 }],
    placeOfSupply: { code: '27', name: 'Maharashtra' },
    taxableValuePaise: 249900,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: 249900,
    ratePercent: 0,
    amountInWords: words,
  },
  refunded: {
    id: 'tax_ref',
    invoiceNumber: 'VRS/2026-27/000127',
    issuedAt: '2026-10-06T06:30:00Z',
    documentType: 'tax_invoice',
    seller,
    buyer: { type: 'individual', name: 'Meera Kapoor' },
    lineItems: [line],
    placeOfSupply: { code: '27', name: 'Maharashtra' },
    taxableValuePaise: 211780,
    cgstPaise: 19060,
    sgstPaise: 19060,
    igstPaise: 0,
    totalPaise: 249900,
    ratePercent: 18,
    amountInWords: words,
    refund: { status: 'full', reference: 'rfnd_QA9' },
    sellerPendingBanner: true,
  },
} as const;

const listItem = (i: {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  documentType: string;
  totalPaise: number;
  buyer: { name: string };
  refund?: { reference: string };
}) => ({
  id: i.id,
  invoiceNumber: i.invoiceNumber,
  issuedAt: i.issuedAt,
  documentType: i.documentType,
  totalPaise: i.totalPaise,
  currency: 'INR',
  buyerName: i.buyer.name,
  refunded: Boolean(i.refund),
  refundReference: i.refund?.reference ?? null,
});

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('checkout: business details', () => {
  test('are folded away by default, validated, and saved just before checkout starts', async ({ page }) => {
    let saved: unknown = null;
    const routes: Record<string, Reply | Handler> = {
      '/api/billing/plans': plans,
      '/api/billing/subscription': { body: { subscription: null, summary: null, history: [], paymentMode: 'live' } },
      'GET /api/billing/profile': profileReply(),
      'PUT /api/billing/profile': (request) => {
        saved = request.postDataJSON();
        return profileReply({ ...(saved as object), version: 1, state: 'Maharashtra', country: 'India' });
      },
      '/api/billing/invoices': { body: { invoices: [] } },
      'POST /api/billing/checkout': { body: { subscription: { id: 's1' }, checkout: { mode: 'mock' } } },
    };
    const calls = await mockApi(page, routes, hirer);
    await page.goto('/employer/billing');

    const toggle = page.getByRole('button', { name: /Buying for a business\? Add GST details/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('GSTIN')).toHaveCount(0);

    // An individual who never opens it is not slowed down: checkout goes straight through.
    await page.getByTestId('plan-pro').getByRole('button', { name: 'Start free trial' }).click();
    await expect(page.getByText('Trial started. Nothing was charged.')).toBeVisible();
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/billing/profile')).toBe(false);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByLabel(/^Business name/).fill('Kapoor Events LLP');
    await page.getByLabel(/^GSTIN/).fill('27AAPFU0939F1ZW');
    await page.getByLabel(/^PIN code/).fill('12');
    await page
      .getByTestId('plan-pro')
      .getByRole('button', { name: /free trial|Switch to Pro/ })
      .click();
    await expect(page.getByText('This GSTIN does not look right. Check the last character.')).toBeVisible();
    await expect(page.getByText('Enter a 6-digit PIN code.')).toBeVisible();
    await expect(page.getByText('Enter the first line of your address.')).toBeVisible();
    await expect(page.getByText('Choose your state.')).toBeVisible();
    expect(calls.filter((c) => c.path === '/api/billing/checkout')).toHaveLength(1);

    await page.getByLabel(/^GSTIN/).fill('29AAGCB7383J1Z4');
    await page.getByLabel(/^Address line 1/).fill('12 Linking Road');
    await page.getByLabel(/^City/).fill('Mumbai');
    await page.getByLabel(/^State/).selectOption('27');
    await page.getByLabel(/^PIN code/).fill('400050');
    await page
      .getByTestId('plan-pro')
      .getByRole('button', { name: /free trial|Switch to Pro/ })
      .click();
    await expect(page.getByText(/This GSTIN is for Karnataka, but you chose Maharashtra/)).toBeVisible();

    await page.getByLabel(/^GSTIN/).fill('27AAPFU0939F1ZV');
    await page.getByLabel(/^PO or reference/).fill('PO-42');
    await page
      .getByTestId('plan-pro')
      .getByRole('button', { name: /free trial|Switch to Pro/ })
      .click();
    await expect
      .poll(() => saved)
      .toMatchObject({
        buyerType: 'business',
        legalName: 'Kapoor Events LLP',
        gstin: '27AAPFU0939F1ZV',
        stateCode: '27',
        postalCode: '400050',
        poReference: 'PO-42',
      });
    await expect.poll(() => calls.filter((c) => c.path === '/api/billing/checkout').length).toBe(2);
    await noHorizontalScroll(page);
  });
});

test.describe('billing details and invoice list', () => {
  test('a musician adds billing details as an individual and sees invoices, including a refunded one', async ({
    page,
  }) => {
    let saved: unknown = null;
    const routes: Record<string, Reply | Handler> = {
      'GET /api/billing/profile': profileReply(),
      'PUT /api/billing/profile': (request) => {
        saved = request.postDataJSON();
        return profileReply({ ...(saved as object), version: 1, state: 'Maharashtra', country: 'India' });
      },
      '/api/billing/invoices': { body: { invoices: [listItem(invoices.b2cIntra), listItem(invoices.refunded)] } },
    };
    await mockApi(page, routes, musician);
    await page.goto('/jobseeker/billing');

    await expect(page.getByTestId('billing-details')).toContainText('Add your name and address');
    await page.getByRole('button', { name: 'Add billing details' }).click();
    const dialog = page.getByRole('dialog', { name: 'Billing details' });
    await dialog.getByRole('button', { name: 'Save billing details' }).click();
    await expect(dialog.getByText('Enter the first line of your address.')).toBeVisible();
    await expect(dialog.getByText('Choose your state.')).toBeVisible();
    await expect(dialog.getByLabel('GSTIN')).toHaveCount(0);

    await dialog.getByLabel(/^Name/).fill('Asha Rao');
    await dialog.getByLabel(/^Address line 1/).fill('5 MG Road');
    await dialog.getByLabel(/^City/).fill('Pune');
    await dialog.getByLabel(/^State/).selectOption('27');
    await dialog.getByLabel(/^PIN code/).fill('411001');
    await dialog.getByRole('button', { name: 'Save billing details' }).click();
    await expect(page.getByTestId('billing-details-summary')).toContainText('Asha Rao');
    expect(saved).toMatchObject({
      buyerType: 'individual',
      legalName: 'Asha Rao',
      stateCode: '27',
      postalCode: '411001',
    });

    const rows = page.getByTestId('invoice-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('VRS/2026-27/000123');
    await expect(rows.first()).toContainText('₹2,499.00');
    await expect(rows.first()).toContainText('Paid');
    await expect(rows.first().getByRole('link', { name: /View or print invoice/ })).toBeVisible();
    await expect(rows.first().getByRole('link', { name: /Download PDF/ })).toBeVisible();
    await expect(rows.nth(1)).toContainText('Refunded');
    await expect(rows.nth(1)).toContainText('rfnd_QA9');
    await noHorizontalScroll(page);
  });

  test('a business can switch the dialog to GST details and sees the GSTIN field', async ({ page }) => {
    await mockApi(
      page,
      { 'GET /api/billing/profile': profileReply(), '/api/billing/invoices': { body: { invoices: [] } } },
      musician,
    );
    await page.goto('/jobseeker/billing');
    await page.getByRole('button', { name: 'Add billing details' }).click();
    const dialog = page.getByRole('dialog', { name: 'Billing details' });
    await dialog.getByLabel('A business').check();
    await expect(dialog.getByLabel(/^GSTIN/)).toBeVisible();
    await expect(dialog.getByLabel(/^PAN/)).toBeVisible();
    await dialog.getByLabel(/^GSTIN/).fill('not-a-gstin');
    await dialog.getByRole('button', { name: 'Save billing details' }).click();
    await expect(dialog.getByText('Enter a 15-character GSTIN, like 27AAPFU0939F1ZV.')).toBeVisible();
  });
});

test.describe('invoice page', () => {
  const open = async (page: Page, key: keyof typeof invoices) => {
    const invoice = invoices[key];
    await mockApi(page, { [`/api/billing/invoices/${invoice.id}`]: { body: { invoice } } }, hirer);
    await page.goto(`/employer/invoices/${invoice.id}/print`);
    await expect(page.getByTestId('invoice-document')).toBeVisible();
  };

  test('individual, same state: CGST and SGST', async ({ page }) => {
    await open(page, 'b2cIntra');
    await expect(page.getByTestId('invoice-title')).toHaveText('Tax invoice');
    await expect(page.getByTestId('invoice-number')).toHaveText('VRS/2026-27/000123');
    await expect(page.getByTestId('cgst')).toHaveText('₹190.60');
    await expect(page.getByTestId('sgst')).toHaveText('₹190.60');
    await expect(page.getByTestId('igst')).toHaveCount(0);
    await expect(page.getByTestId('invoice-total')).toHaveText('₹2,499.00');
    await expect(page.getByTestId('amount-in-words')).toContainText('Two Thousand Four Hundred Ninety Nine');
    await expect(page.getByTestId('invoice-buyer')).not.toContainText('GSTIN');
    await expect(page.getByTestId('invoice-seller')).toContainText('GSTIN: 27AAPFU0939F1ZV');
    await expect(page.getByTestId('seller-pending-banner')).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test('business, other state: IGST, buyer GSTIN and PO number', async ({ page }) => {
    await open(page, 'b2bInter');
    await expect(page.getByTestId('igst')).toHaveText('₹381.20');
    await expect(page.getByTestId('cgst')).toHaveCount(0);
    await expect(page.getByTestId('invoice-buyer')).toContainText('GSTIN: 29AAGCB7383J1Z4');
    await expect(page.getByTestId('invoice-buyer')).toContainText('PO / reference: PO-2026/0042');
    await expect(page.getByTestId('place-of-supply')).toContainText('Karnataka (29)');
    await noHorizontalScroll(page);
  });

  test('business, same state: CGST and SGST with the buyer GSTIN', async ({ page }) => {
    await open(page, 'b2bIntra');
    await expect(page.getByTestId('cgst')).toBeVisible();
    await expect(page.getByTestId('sgst')).toBeVisible();
    await expect(page.getByTestId('invoice-buyer')).toContainText('GSTIN: 27AAPFU0939F1ZV');
  });

  test('a seller who is not GST-registered issues a bill of supply with no GST lines', async ({ page }) => {
    await open(page, 'billOfSupply');
    await expect(page.getByTestId('invoice-title')).toHaveText('Bill of supply');
    await expect(page.getByTestId('invoice-document')).not.toContainText(/CGST|SGST|IGST/);
    await expect(page.getByTestId('invoice-total')).toHaveText('₹2,499.00');
  });

  test('refund reference and the seller-pending banner show when they apply', async ({ page }) => {
    await open(page, 'refunded');
    await expect(page.getByTestId('invoice-refunded')).toContainText('Refunded');
    await expect(page.getByTestId('invoice-refunded')).toContainText('rfnd_QA9');
    await expect(page.getByTestId('seller-pending-banner')).toContainText('Seller details pending');
  });

  test('Download PDF opens print with the invoice number as the document title', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printedAs: string[] }).printedAs = [];
      window.print = () => (window as unknown as { printedAs: string[] }).printedAs.push(document.title);
    });
    await open(page, 'b2cIntra');
    await page.getByRole('button', { name: 'Download PDF' }).click();
    expect(await page.evaluate(() => (window as unknown as { printedAs: string[] }).printedAs)).toEqual([
      'Invoice-VRS-2026-27-000123',
    ]);
    await expect.poll(() => page.title()).not.toContain('Invoice-VRS-2026-27-000123');
  });

  test("the list's Download PDF link opens the print dialog by itself", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printedAs: string[] }).printedAs = [];
      window.print = () => (window as unknown as { printedAs: string[] }).printedAs.push(document.title);
    });
    const invoice = invoices.b2cIntra;
    await mockApi(page, { [`/api/billing/invoices/${invoice.id}`]: { body: { invoice } } }, hirer);
    await page.goto(`/employer/invoices/${invoice.id}/print?print=1`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { printedAs: string[] }).printedAs.length))
      .toBe(1);
    expect(page.url()).not.toContain('print=1');
  });

  for (const key of ['b2cIntra', 'b2bInter'] as const) {
    test(`print layout (${key}) fits an A4 page with no overflow and hides the toolbar`, async ({ page }) => {
      await page.setViewportSize({ width: 794, height: 1123 });
      await open(page, key);
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByRole('button', { name: 'Download PDF' })).toBeHidden();
      const metrics = await page.evaluate(() => {
        const doc = document.querySelector<HTMLElement>('[data-testid="invoice-document"]')!;
        const wide = Array.from(doc.querySelectorAll<HTMLElement>('*')).filter(
          (el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0,
        );
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          doc: doc.scrollWidth - doc.clientWidth,
          wide: wide.map((el) => el.tagName + '.' + el.className).slice(0, 3),
          background: getComputedStyle(document.querySelector('.invoice-page')!).backgroundColor,
        };
      });
      expect(metrics.page).toBeLessThanOrEqual(0);
      expect(metrics.doc).toBeLessThanOrEqual(0);
      expect(metrics.wide).toEqual([]);
      expect(metrics.background).toBe('rgb(255, 255, 255)');
    });
  }

  test('on a phone screen nothing scrolls sideways, even with a long business name', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await open(page, 'b2bInter');
    await noHorizontalScroll(page);
    const table = await page.getByTestId('invoice-lines').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(table).toBeLessThanOrEqual(0);
  });
});
