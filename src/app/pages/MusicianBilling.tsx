import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { apiGet, apiPost } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { BillingCancellation } from '../lib/apiTypes';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { UserAvatar } from '../components/kit/UserAvatar';
import { useAuth } from '../lib/authContext';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { usePageMeta } from '../components/PageMeta';
import { BillingDetailsCard } from '../components/billing/BillingDetailsCard';
import { InvoiceList } from '../components/billing/InvoiceList';
import { useBillingProfile } from '../lib/billingProfile';

/**
 * Billing for a musician. Verse is free for musicians during the beta, so there is nothing to
 * buy here and no hirer plans to show. (Hirers, and musicians who also hire, use /employer/billing.)
 */
export default function MusicianBilling() {
  const { user } = useAuth();
  const profileApi = useBillingProfile();
  usePageMeta('Plan & billing', 'Verse is free for musicians during the beta.');
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  // One-click cancel link from a reminder email (?cancel=1&t=...). Clean the params at once so a
  // reload or shared URL never re-triggers it, verify the token for the signed-in user, then open
  // the confirmation. Nothing is cancelled until the person presses the confirm button.
  useEffect(() => {
    if (searchParams.get('cancel') !== '1') return;
    const token = searchParams.get('t');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('cancel');
        next.delete('t');
        return next;
      },
      { replace: true },
    );
    if (!token) return;
    apiGet(`/billing/cancel-link?t=${encodeURIComponent(token)}`)
      .then(() => setConfirmOpen(true))
      .catch(() => toast.error('This cancel link is invalid or has expired. Sign in to the account it was sent to.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once, off the initial query string only
  }, []);

  async function cancel() {
    setCancelling(true);
    setCancelError('');
    try {
      const d = await apiPost<BillingCancellation>('/billing/cancel', {});
      toast.success(
        d.outcome === 'scheduled'
          ? 'Cancellation scheduled. You will not be charged again.'
          : 'Subscription cancelled. You will not be charged.',
      );
      setConfirmOpen(false);
    } catch (e: unknown) {
      setCancelError(errorMessage(e, 'We could not cancel right now. Try again.'));
    } finally {
      setCancelling(false);
    }
  }
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-3xl px-5 pb-16 pt-28">
        <PageHeader title="Plan & billing" />
        <section
          aria-labelledby="free-beta"
          data-testid="free-during-beta"
          className="flex gap-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/[.06] p-5"
        >
          <UserAvatar
            id={user?.id || 'me'}
            name={user?.name || 'You'}
            size="xl"
            photoUrl={user?.photoUrl}
            art={!user?.photoUrl}
            eager
          />
          <div>
            <h2 id="free-beta" className="text-lg font-semibold">
              Free during beta
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Your profile, work, applications and messages cost nothing. We will tell you well before that changes.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/jobseeker/library">Add your work</Link>
            </Button>
          </div>
        </section>
        <BillingDetailsCard api={profileApi} />
        <InvoiceList />
      </main>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!cancelling) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              You will not be charged again. Any paid features end with the current billing period. You can subscribe
              again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelError && (
            <p role="alert" className="text-sm text-rose-300">
              {cancelError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep subscription</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(event) => {
                event.preventDefault();
                void cancel();
              }}
            >
              {cancelling ? 'Cancelling…' : 'Cancel subscription'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
