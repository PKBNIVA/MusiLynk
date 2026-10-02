import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Download, Eye } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { apiGet } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { DOCUMENT_TITLE, formatPaise, type InvoiceListItem } from '../../lib/billingProfile';

/** The account's subscription invoices, each with View / Print and Download PDF. Hidden until there is one. */
export function InvoiceList() {
  // The billing page lives under /employer or /jobseeker; invoices open in the same workspace.
  const base = useLocation().pathname.startsWith('/employer') ? '/employer' : '/jobseeker';
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  useEffect(() => {
    let active = true;
    apiGet<{ invoices?: InvoiceListItem[] }>('/billing/invoices')
      .then((d) => {
        if (active && Array.isArray(d?.invoices)) setInvoices(d.invoices);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!invoices.length) return null;
  return (
    <Card className="mt-8 border-white/10 bg-white/[.04]" data-testid="invoice-list">
      <CardContent className="p-5">
        <h2 className="font-semibold">Invoices</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Invoice</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-white/10" data-testid="invoice-row">
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs">{invoice.invoiceNumber}</span>
                    <span className="block text-xs text-slate-500">{DOCUMENT_TITLE[invoice.documentType]}</span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatDate(invoice.issuedAt)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatPaise(invoice.totalPaise)}</td>
                  <td className="py-2 pr-4">
                    {invoice.refunded ? (
                      <>
                        Refunded
                        {invoice.refundReference && (
                          <span className="block font-mono text-xs text-slate-500">{invoice.refundReference}</span>
                        )}
                      </>
                    ) : (
                      'Paid'
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <Link
                        to={`${base}/invoices/${encodeURIComponent(invoice.id)}/print`}
                        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-violet-300 hover:text-violet-200"
                        aria-label={`View or print invoice ${invoice.invoiceNumber}`}
                      >
                        <Eye size={14} aria-hidden="true" />
                        View / Print
                      </Link>
                      <Link
                        to={`${base}/invoices/${encodeURIComponent(invoice.id)}/print?print=1`}
                        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-violet-300 hover:text-violet-200"
                        aria-label={`Download PDF of invoice ${invoice.invoiceNumber}`}
                      >
                        <Download size={14} aria-hidden="true" />
                        Download PDF
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
