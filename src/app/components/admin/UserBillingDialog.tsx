import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { formatPaise, type BillingProfile, type InvoiceListItem } from '../../lib/billingProfile';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

type Response = {
  profile: (BillingProfile & { version: number }) | null;
  versions: Array<BillingProfile & { version: number }>;
  invoices: InvoiceListItem[];
};

/** Read-only: an account's billing details (and earlier versions) and its invoices. */
export function UserBillingDialog({
  user,
  onClose,
}: {
  user: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setData(null);
    setError('');
    if (!user) return;
    let active = true;
    apiGet<Response>(`/admin/users/${encodeURIComponent(user.id)}/billing`)
      .then((d) => active && setData(d))
      .catch((e: unknown) => active && setError(errorMessage(e, 'Unable to load billing details.')));
    return () => {
      active = false;
    };
  }, [user]);
  const p = data?.profile;
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="user-billing-dialog">
        <DialogHeader>
          <DialogTitle>Billing: {user?.name}</DialogTitle>
          <DialogDescription>Read-only. Customers edit their own billing details.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        {!data && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {data && (
          <div className="space-y-4 text-sm">
            {p ? (
              <div data-testid="user-billing-profile">
                <p className="font-semibold">
                  {p.legalName} · {p.buyerType === 'business' ? 'Business' : 'Individual'} · version {p.version}
                  {data.versions.length > 1 ? ` of ${data.versions.length}` : ''}
                </p>
                {p.gstin && <p className="font-mono text-xs">GSTIN {p.gstin}</p>}
                {p.pan && <p className="font-mono text-xs">PAN {p.pan}</p>}
                <p>{[p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode].filter(Boolean).join(', ')}</p>
                <p className="text-slate-400">{p.billingEmail}</p>
                {p.poReference && <p className="text-slate-400">PO {p.poReference}</p>}
              </div>
            ) : (
              <p className="text-slate-400">No billing details saved.</p>
            )}
            <div>
              <h3 className="font-medium">Invoices</h3>
              {data.invoices.length === 0 ? (
                <p className="text-slate-400">None.</p>
              ) : (
                <ul className="mt-1 space-y-1" data-testid="user-billing-invoices">
                  {data.invoices.map((i) => (
                    <li key={i.id} className="flex flex-wrap justify-between gap-2 border-t border-white/10 pt-1">
                      <span className="font-mono text-xs">{i.invoiceNumber}</span>
                      <span>{formatDate(i.issuedAt)}</span>
                      <span>{formatPaise(i.totalPaise)}</span>
                      <span>{i.refunded ? 'Refunded' : 'Paid'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
