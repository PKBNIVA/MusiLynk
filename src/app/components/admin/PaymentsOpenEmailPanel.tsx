import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type Summary = { usable: boolean; waiting: number; sendable: number };

const normalise = (d: Partial<Summary>): Summary => ({
  usable: d.usable === true,
  waiting: Number(d.waiting) || 0,
  sendable: Number(d.sendable) || 0,
});

const people = (n: number) => `${formatNumber(n)} ${n === 1 ? 'member is' : 'members are'}`;

/** One email to everyone who ticked "Email me when payments open"; each is emailed once. */
export default function PaymentsOpenEmailPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<Partial<Summary>>('/admin/payments-open-email')
      .then((d) => {
        setSummary(normalise(d));
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e, 'Unable to load who is waiting.')));
  }, []);
  useEffect(load, [load]);

  async function send() {
    setBusy(true);
    try {
      const d = normalise(await apiPost<Partial<Summary>>('/admin/payments-open-email', {}));
      toast.success(`Queued ${formatNumber(d.sendable)} ${d.sendable === 1 ? 'email' : 'emails'}.`);
      setConfirming(false);
      // The emails go out in the background; give the list a moment to drain before re-reading it.
      window.setTimeout(load, 2000);
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Unable to send these emails.'));
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!summary && summary.usable && summary.sendable > 0 && !busy;
  const reason = !summary
    ? ''
    : !summary.usable
      ? 'Payments are not open yet. Add working Razorpay keys first.'
      : summary.sendable === 0
        ? 'Nobody can be emailed right now.'
        : '';

  return (
    <Card className="bg-white/[.05] border-white/10 mb-6" data-testid="payments-open-email">
      <CardHeader>
        <CardTitle>
          <h2>Payments-open email</h2>
        </CardTitle>
        <p className="text-sm text-slate-400">
          Members who ticked “Email me when payments open” get one email with a link to pricing, then their tick is
          cleared so nobody is emailed twice.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}{' '}
            <button type="button" className="underline" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {summary && (
          <p className="text-sm" data-testid="payments-open-waiting">
            {people(summary.waiting)} waiting
            {summary.sendable !== summary.waiting && <> ({formatNumber(summary.sendable)} can be emailed now)</>}.
          </p>
        )}
        <Button disabled={!canSend} onClick={() => setConfirming(true)} aria-describedby="payments-open-reason">
          <Mail aria-hidden="true" size={16} className="mr-2" />
          Email members waiting for payments
        </Button>
        {reason && (
          <p id="payments-open-reason" className="text-xs text-slate-400">
            {reason}
          </p>
        )}
      </CardContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="bg-slate-900 border-white/15 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Email {summary ? formatNumber(summary.sendable) : ''} members?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              Each member gets one email saying payments are open, with a link to pricing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {busy ? 'Sending…' : 'Send emails'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
