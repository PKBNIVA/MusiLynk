import { useState } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api, apiDelete, setAccessToken } from '../lib/api';
import { useAuth } from '../lib/authContext';
import { errorMessage } from '../lib/errors';

/** Download a copy of your data, or delete your account (DPDP Act rights to access and erasure). */
export default function AccountData() {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const matches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  async function download() {
    setExporting(true);
    try {
      const data = await api<unknown>('/account/export', { method: 'GET' });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `verse-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Your data file is downloading');
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Your data could not be prepared. Try again.'));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!matches || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiDelete('/account', { body: JSON.stringify({ confirmEmail: confirmEmail.trim() }) });
      // A full reload to the home page: an in-app navigation races the route guard,
      // which would send the now signed-out user to the sign-in page instead.
      setAccessToken(null);
      window.location.replace('/');
    } catch (err: unknown) {
      setDeleteError(errorMessage(err, 'Your account could not be deleted. Try again.'));
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-3xl mx-auto px-5 md:px-6 pt-28 pb-16 space-y-6">
        <div>
          <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Your data</div>
          <h1 className="text-4xl font-bold">Account and privacy</h1>
          <p className="text-slate-400 mt-2">
            Download everything Verse holds about you, or delete your account. Read the{' '}
            <a href="/privacy" className="underline hover:text-white">
              privacy policy
            </a>{' '}
            for how long we keep records.
          </p>
        </div>

        <Card className="bg-white/[.055] border-white/10">
          <CardHeader>
            <CardTitle>Download my data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300">
            <p>
              A JSON file with your account, profile, portfolio, applications, jobs you posted, messages, notifications,
              bookings and billing history.
            </p>
            <Button type="button" onClick={download} disabled={exporting} aria-busy={exporting}>
              <Download size={16} className="mr-2" />
              {exporting ? 'Preparing file…' : 'Download my data'}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-rose-500/[.06] border-rose-400/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-rose-300" />
              Delete my account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={deleteAccount} className="space-y-4 text-sm text-slate-300">
              <p>This cannot be undone. When you delete your account:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Your profile, portfolio, uploaded files, applications, saved jobs, alerts and reviews are removed.
                </li>
                <li>Jobs, acts and requests you posted are closed.</li>
                <li>
                  Messages you already sent stay with the people you sent them to, shown as from “Deleted account”.
                </li>
                <li>Payment records are kept because tax law requires it.</li>
              </ul>
              <p>Cancel any paid plan and finish or cancel open bookings first.</p>
              <div>
                <Label htmlFor="confirm-email">Type your account email to confirm</Label>
                <Input
                  id="confirm-email"
                  type="email"
                  autoComplete="off"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={user?.email}
                  className="mt-2 bg-black/20 border-white/15"
                />
              </div>
              {deleteError && (
                <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                  {deleteError}
                </p>
              )}
              <Button type="submit" variant="destructive" disabled={!matches || deleting} aria-busy={deleting}>
                {deleting ? 'Deleting account…' : 'Delete my account'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
