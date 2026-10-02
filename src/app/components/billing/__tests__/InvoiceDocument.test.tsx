import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { InvoiceDocument } from '../InvoiceDocument';
import type { InvoiceDocumentData } from '../../../lib/billingProfile';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base: InvoiceDocumentData = {
  id: 'tax_1',
  invoiceNumber: 'MLK/2026-27/000123',
  issuedAt: '2026-10-02T06:30:00Z',
  documentType: 'tax_invoice',
  seller: { legalName: 'Alien Brains Pvt Ltd', gstin: '27AAPFU0939F1ZV', stateCode: '27', state: 'Maharashtra' },
  buyer: { name: 'Meera Kapoor', type: 'individual' },
  lineItems: [{ description: 'MusiLynk Pro plan, monthly subscription', sacCode: '998314', taxableValuePaise: 211780 }],
  placeOfSupply: { code: '27', name: 'Maharashtra' },
  taxableValuePaise: 211780,
  cgstPaise: 19060,
  sgstPaise: 19060,
  igstPaise: 0,
  totalPaise: 249900,
  ratePercent: 18,
  amountInWords: 'Indian Rupees Two Thousand Four Hundred Ninety Nine Only',
};

let host: HTMLDivElement | null = null;
function render(invoice: InvoiceDocumentData, props: { showPendingBanner?: boolean } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<InvoiceDocument invoice={invoice} {...props} />));
  return host;
}
afterEach(() => {
  host?.remove();
  host = null;
});

describe('InvoiceDocument', () => {
  it('shows CGST and SGST for an intra-state tax invoice', () => {
    const el = render(base);
    expect(el.querySelector('[data-testid="invoice-title"]')?.textContent).toBe('Tax invoice');
    expect(el.querySelector('[data-testid="cgst"]')?.textContent).toBe('₹190.60');
    expect(el.querySelector('[data-testid="sgst"]')?.textContent).toBe('₹190.60');
    expect(el.querySelector('[data-testid="igst"]')).toBeNull();
    expect(el.querySelector('[data-testid="invoice-total"]')?.textContent).toBe('₹2,499.00');
    expect(el.textContent).toContain('CGST @ 9%');
  });
  it('shows IGST for an inter-state B2B invoice with the buyer GSTIN', () => {
    const el = render({
      ...base,
      buyer: {
        name: 'Kapoor Events LLP',
        type: 'business',
        gstin: '29AAGCB7383J1Z4',
        state: 'Karnataka',
        stateCode: '29',
      },
      placeOfSupply: { code: '29', name: 'Karnataka' },
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 38120,
    });
    expect(el.querySelector('[data-testid="igst"]')?.textContent).toBe('₹381.20');
    expect(el.querySelector('[data-testid="cgst"]')).toBeNull();
    expect(el.querySelector('[data-testid="invoice-buyer"]')?.textContent).toContain('GSTIN: 29AAGCB7383J1Z4');
    expect(el.querySelector('[data-testid="place-of-supply"]')?.textContent).toContain('Karnataka (29)');
  });
  it('is a bill of supply with no tax lines when the seller is not registered', () => {
    const el = render({
      ...base,
      documentType: 'bill_of_supply',
      seller: { legalName: 'Alien Brains Pvt Ltd' },
      taxableValuePaise: 249900,
      cgstPaise: 0,
      sgstPaise: 0,
      ratePercent: 0,
    });
    expect(el.querySelector('[data-testid="invoice-title"]')?.textContent).toBe('Bill of supply');
    expect(el.textContent).not.toMatch(/CGST|SGST|IGST|SAC/);
    expect(el.textContent).toContain('not registered under GST');
  });
  it('shows refunded with the reference, the pending banner, and the amount in words', () => {
    const el = render({ ...base, refund: { status: 'full', reference: 'rfnd_abc123' }, sellerPendingBanner: true });
    expect(el.querySelector('[data-testid="invoice-refunded"]')?.textContent).toContain('rfnd_abc123');
    expect(el.querySelector('[data-testid="seller-pending-banner"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="amount-in-words"]')?.textContent).toContain(
      'Two Thousand Four Hundred Ninety Nine',
    );
  });
});
