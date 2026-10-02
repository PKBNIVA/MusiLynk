import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Button } from '../components/ui/button';
import { usePageMeta } from '../components/PageMeta';
import { useWorkspaceBase } from '../components/showcase/parts';
import { InvoiceDocument } from '../components/billing/InvoiceDocument';
import { apiGet } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { printInvoice, type InvoiceDocumentData } from '../lib/billingProfile';

// GET /api/invoices/:id (InvoicesController#show): the booking-deposit invoice. GST fields come
// from config/legal.yml at render time; a blank GSTIN prints blank rather than a placeholder, since
// a real GSTIN must never be fabricated (see backend/docs/compliance-checklist.md).
type BookingInvoiceDetail = {
  invoiceNumber: string;
  financialYear: string;
  createdAt: string;
  currency: string;
  depositAmount: number;
  feeAmount: number;
  gstAmount: number;
  totalAmount: number;
  policyVersion: number;
  actName: string;
  payerName: string;
  bookingId: string;
  amountInWords?: string;
  seller: { legalName: string; gstin: string; gstinPresent: boolean; businessAddress: string; businessState: string };
};

const paise = (rupees: number) => Math.round(Number(rupees || 0) * 100);

function fromBooking(id: string, b: BookingInvoiceDetail): InvoiceDocumentData {
  return {
    id,
    invoiceNumber: b.invoiceNumber,
    issuedAt: b.createdAt,
    documentType: 'booking_invoice',
    seller: {
      legalName: b.seller.legalName,
      address: b.seller.businessAddress,
      state: b.seller.businessState,
      gstin: b.seller.gstinPresent ? b.seller.gstin : '',
    },
    buyer: { name: b.payerName },
    lineItems: [
      { description: `Booking deposit, ${b.actName}`, taxableValuePaise: paise(b.depositAmount) },
      { description: 'MusiLynk platform fee', taxableValuePaise: paise(b.feeAmount) },
      { description: 'GST on platform fee', taxableValuePaise: paise(b.gstAmount) },
    ],
    taxableValuePaise: paise(b.totalAmount),
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: paise(b.totalAmount),
    ratePercent: 0,
    amountInWords: b.amountInWords ?? '',
    note: `Booking fee policy version ${b.policyVersion}. Draft invoice generated automatically, for a lawyer/CA to review. Not legal or tax advice.`,
  };
}

/**
 * The invoice laid out for paper: black on white, A4, no navigation. "Download PDF" opens the
 * browser's print dialog titled with the invoice number, so "Save as PDF" proposes the right file
 * name; nothing is rendered on the server. Serves /invoices/:id/print for booking-deposit invoices and for subscription invoices. `?print=1` (the list's Download PDF link) opens it at once.
 */
export default function InvoicePrint() {
  const { id = '' } = useParams();
  // One page for both documents, so no extra route is needed in the entry bundle: subscription invoice ids start "tax_".
  const kind: 'booking' | 'subscription' = id.startsWith('tax_') ? 'subscription' : 'booking';
  const [search, setSearch] = useSearchParams();
  const base = useWorkspaceBase();
  const [invoice, setInvoice] = useState<InvoiceDocumentData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    const request =
      kind === 'subscription'
        ? apiGet<{ invoice: InvoiceDocumentData }>(`/billing/invoices/${encodeURIComponent(id)}`).then((d) => d.invoice)
        : apiGet<BookingInvoiceDetail>(`/invoices/${encodeURIComponent(id)}`).then((d) => fromBooking(id, d));
    request.then(setInvoice).catch((e: unknown) => setError(errorMessage(e, 'This invoice could not be loaded.')));
  }, [id, kind]);
  useEffect(load, [load]);
  usePageMeta(invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice');

  const autoPrinted = useRef(false);
  const printTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(printTimer.current), []);
  useEffect(() => {
    if (!invoice || autoPrinted.current || search.get('print') !== '1') return;
    autoPrinted.current = true;
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('print');
        return next;
      },
      { replace: true },
    );
    // Let the document paint before the print dialog opens.
    printTimer.current = window.setTimeout(() => printInvoice(invoice.invoiceNumber), 300);
  }, [invoice, search, setSearch]);

  const back = kind === 'subscription' ? `${base}/billing` : `${base}/bookings`;
  return (
    <div className="invoice-page min-h-screen bg-slate-200 text-slate-900 print:bg-white">
      <style>
        {'@media print { @page { size: A4; margin: 12mm; } .invoice-page { background: #fff !important; } }'}
      </style>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-4 print:hidden">
        <Link
          to={back}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-slate-700 hover:text-slate-950"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {kind === 'subscription' ? 'Back to billing' : 'Back to bookings'}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => invoice && printInvoice(invoice.invoiceNumber)}
            disabled={!invoice}
            className="border-slate-400 bg-white text-slate-900 hover:bg-slate-100"
          >
            <Printer size={16} aria-hidden="true" />
            Print
          </Button>
          <Button
            onClick={() => invoice && printInvoice(invoice.invoiceNumber)}
            disabled={!invoice}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            <Download size={16} aria-hidden="true" />
            Download PDF
          </Button>
        </div>
      </div>
      <main
        className="mx-auto mb-10 max-w-[210mm] bg-white px-5 py-6 shadow-xl sm:px-12 sm:py-12 print:m-0 print:max-w-none print:p-0 print:shadow-none"
        data-testid="invoice-print"
      >
        {!invoice ? (
          <p role={error ? 'alert' : 'status'} className="text-slate-700">
            {error || 'Loading…'}
          </p>
        ) : (
          <InvoiceDocument invoice={invoice} />
        )}
      </main>
      {invoice && (
        <p className="mx-auto mb-8 max-w-[210mm] px-4 text-center text-xs text-slate-600 print:hidden">
          To save a PDF, choose “Save as PDF” as the printer in the print window.
        </p>
      )}
    </div>
  );
}
