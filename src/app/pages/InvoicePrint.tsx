import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '../components/ui/button';
import { usePageMeta } from '../components/PageMeta';
import { useWorkspaceBase } from '../components/showcase/parts';
import { apiGet } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';

// GET /api/invoices/:id (InvoicesController#show). GST fields come from config/legal.yml at
// render time; a blank GSTIN prints blank rather than a placeholder, since a real GSTIN must
// never be fabricated (see backend/docs/compliance-checklist.md).
type InvoiceDetail = {
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
  seller: {
    legalName: string;
    gstin: string;
    gstinPresent: boolean;
    businessAddress: string;
    businessState: string;
  };
};

const money = (currency: string, value: number) => formatMoney(Number(value || 0), currency);

/**
 * The invoice laid out for paper: black on white, no navigation. The browser's own
 * "Print → Save as PDF" makes the PDF; nothing is rendered on the server. This is a draft
 * invoice generator for a lawyer/CA to review, not a substitute for one (see
 * backend/docs/compliance-checklist.md).
 */
export default function InvoicePrint() {
  const { id = '' } = useParams();
  const base = useWorkspaceBase();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    apiGet<InvoiceDetail>(`/invoices/${encodeURIComponent(id)}`)
      .then(setInvoice)
      .catch((e: unknown) => setError(errorMessage(e, 'This invoice could not be loaded.')));
  }, [id]);
  useEffect(load, [load]);
  usePageMeta(invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice');

  return (
    <div className="min-h-screen bg-slate-200 text-slate-900 print:bg-white">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-4 print:hidden">
        <Link
          to={`${base}/bookings`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-slate-700 hover:text-slate-950"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to bookings
        </Link>
        <Button
          onClick={() => window.print()}
          disabled={!invoice}
          className="bg-slate-900 text-white hover:bg-slate-800"
        >
          <Printer size={16} aria-hidden="true" />
          Print or save as PDF
        </Button>
      </div>
      <main
        className="mx-auto mb-10 max-w-[210mm] bg-white px-6 py-8 shadow-xl sm:px-12 sm:py-12 print:m-0 print:max-w-none print:p-0 print:shadow-none"
        data-testid="invoice-print"
      >
        {!invoice ? (
          <p role={error ? 'alert' : 'status'} className="text-slate-700">
            {error || 'Loading…'}
          </p>
        ) : (
          <article>
            <div className="mb-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:border-slate-400 print:bg-white">
              Draft invoice — generated automatically, for a lawyer/CA to review before this format is relied on. Not
              legal or tax advice.
            </div>
            <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{invoice.seller.legalName}</h1>
                {invoice.seller.businessAddress && (
                  <p className="mt-1 text-sm text-slate-700">{invoice.seller.businessAddress}</p>
                )}
                {invoice.seller.businessState && (
                  <p className="text-sm text-slate-700">{invoice.seller.businessState}</p>
                )}
                <p className="mt-1 text-sm text-slate-700">
                  GSTIN: {invoice.seller.gstinPresent ? invoice.seller.gstin : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold">Invoice {invoice.invoiceNumber}</p>
                <p className="text-sm text-slate-700">FY {invoice.financialYear}</p>
                <p className="text-sm text-slate-700">{formatDate(invoice.createdAt)}</p>
              </div>
            </header>
            <div className="mt-5 flex flex-wrap justify-between gap-4 text-sm text-slate-800">
              <div>
                <p className="font-semibold text-slate-900">Billed to</p>
                <p>{invoice.payerName}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">For booking with</p>
                <p>{invoice.actName}</p>
              </div>
            </div>
            <table className="mt-6 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-slate-700">
                  <th className="py-2">Line</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2">Booking deposit</td>
                  <td className="py-2 text-right">{money(invoice.currency, invoice.depositAmount)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2">Verse platform fee</td>
                  <td className="py-2 text-right">{money(invoice.currency, invoice.feeAmount)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2">GST on platform fee</td>
                  <td className="py-2 text-right">{money(invoice.currency, invoice.gstAmount)}</td>
                </tr>
                <tr>
                  <td className="py-2 font-semibold">Total</td>
                  <td className="py-2 text-right font-semibold">{money(invoice.currency, invoice.totalAmount)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-6 text-xs text-slate-500">Booking fee policy version {invoice.policyVersion}.</p>
          </article>
        )}
      </main>
    </div>
  );
}
