import { useEffect, useState } from 'react';
import { AlertTriangle, Download, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet } from '../../lib/api';
import { apiDownload } from '../../lib/download';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatPaise, type InvoiceListItem } from '../../lib/billingProfile';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/** Today in IST as YYYY-MM-DD. */
const istDate = (offsetDays = 0) =>
  new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Subscription invoices for the accountant: the latest ones (read-only) and a CSV export for a date
 * range. Warns while the seller details in config/legal.yml are still placeholders.
 */
export function InvoicesPanel() {
  const [invoices, setInvoices] = useState<Array<InvoiceListItem & { email?: string }> | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(() => istDate(-30));
  const [to, setTo] = useState(() => istDate());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    apiGet<{ invoices: Array<InvoiceListItem & { email?: string }>; sellerPending?: string[] }>(
      '/admin/invoices?perPage=20',
    )
      .then((d) => {
        setInvoices(d.invoices ?? []);
        setPending(d.sellerPending ?? []);
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Unable to load invoices.')));
  }, []);

  async function exportCsv() {
    if (!from || !to || to < from) {
      toast.error('Choose a from date and a to date that is the same or later.');
      return;
    }
    setExporting(true);
    try {
      const blob = await apiDownload(`/admin/invoices/export.csv?from=${from}&to=${to}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoices-${from}-to-${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'The export could not be prepared.'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="bg-white/[.05] border-white/10 xl:col-span-2" data-testid="admin-invoices">
      <CardHeader>
        <CardTitle>
          <h2>Invoices</h2>
        </CardTitle>
        <p className="text-sm text-slate-400">
          GST invoices and bills of supply issued for subscription charges. Read-only. Export a date range for your
          accountant.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending.length > 0 && (
          <div
            role="alert"
            data-testid="invoice-seller-pending"
            className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100"
          >
            <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
            <span>
              <b>Seller details pending.</b> Invoices are held back in production until these are filled in{' '}
              <span className="font-mono text-xs">backend/config/legal.yml</span>:{' '}
              <span className="font-mono text-xs">{pending.join(', ')}</span>
            </span>
          </div>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void exportCsv();
          }}
        >
          <div>
            <Label htmlFor="invoice-export-from">From</Label>
            <Input id="invoice-export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="invoice-export-to">To</Label>
            <Input id="invoice-export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={exporting}>
            <Download aria-hidden="true" size={15} className="mr-1.5" />
            {exporting ? 'Preparing…' : 'Export invoices CSV'}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        {invoices && invoices.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <FileText aria-hidden="true" size={15} /> No invoices yet.
          </p>
        )}
        {invoices && invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Number</th>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Buyer</th>
                  <th className="py-2 pr-4 font-medium">Total</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-t border-white/10">
                    <td className="py-2 pr-4 font-mono text-xs">{i.invoiceNumber}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDate(i.issuedAt)}</td>
                    <td className="py-2 pr-4 break-words">{i.buyerName}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{formatPaise(i.totalPaise)}</td>
                    <td className="py-2">{i.refunded ? `Refunded ${i.refundReference ?? ''}` : 'Paid'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
