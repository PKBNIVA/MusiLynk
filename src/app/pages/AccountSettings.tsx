import { useState } from 'react';
import { Link } from 'react-router';
import { KeyRound, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { apiPatch, apiPost } from '../lib/api';
import { useAuth, type User } from '../lib/authContext';
import { errorCode, errorMessage } from '../lib/errors';
import { checkPasswordStrength } from '../lib/passwordStrength';

interface EmailChallenge {
  changeToken: string;
  expiresIn: number;
  message: string;
  debugCode?: string;
}

/** Name, email (proved by a code to the new address) and password, for both roles.
 * Export/delete live on AccountData (linked below), unchanged. */
export default function AccountSettings() {
  const { user, setUser } = useAuth();
  const baseUrl = user?.role === 'employer' ? '/employer' : '/jobseeker';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-3xl mx-auto px-5 md:px-6 pt-28 pb-16 space-y-6">
        <div>
          <div className="text-xs uppercase tracking-[.22em] text-violet-300 mb-2">Settings</div>
          <h1 className="text-4xl font-bold">Account settings</h1>
          <p className="text-slate-400 mt-2">
            Update your name, email and password. Looking for your data or to delete your account? Visit{' '}
            <Link to={`${baseUrl}/account`} className="underline hover:text-white">
              your data &amp; account
            </Link>
            .
          </p>
        </div>

        {user && <NameCard user={user} onSaved={setUser} />}
        {user && <EmailCard user={user} onSaved={setUser} />}
        {user && <PasswordCard user={user} />}
      </main>
    </div>
  );
}

function NameCard({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || name.trim() === user.name) return;
    setBusy(true);
    try {
      const d = await apiPatch<{ user: User }>('/account/name', { name: name.trim() });
      onSaved(d.user);
      toast.success('Name updated');
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not update your name.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserIcon size={18} className="text-violet-300" />
          Name
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col sm:flex-row gap-3 sm:items-end" aria-busy={busy}>
          <div className="flex-1">
            <Label htmlFor="settings-name">Full name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={120}
              required
              className="mt-2 bg-black/20 border-white/15"
            />
          </div>
          <Button type="submit" disabled={busy || name.trim() === user.name} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save name'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailCard({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setStep('idle');
    setEmail('');
    setCode('');
    setChallenge(null);
    setError('');
  }

  async function requestChange(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const d = await apiPost<EmailChallenge>('/account/email/request', { email: email.trim() });
      setChallenge(d);
      setStep('code');
      setCode('');
      toast.success(d.message);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not start the email change.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmChange(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !challenge) return;
    setBusy(true);
    setError('');
    try {
      const d = await apiPost<{ user: User }>('/account/email/confirm', { changeToken: challenge.changeToken, code });
      onSaved(d.user);
      toast.success('Email address updated. Other sessions were signed out.');
      reset();
    } catch (err: unknown) {
      if (errorCode(err) === 'EMAIL_CHANGE_EXPIRED') {
        setError(errorMessage(err));
        setStep('idle');
        setChallenge(null);
        return;
      }
      setError(errorMessage(err, 'Invalid or expired code.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail size={18} className="text-violet-300" />
          Email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-300">
        <p>
          Current email: <span className="font-semibold text-white">{user.email}</span>
        </p>
        {step === 'idle' ? (
          <form onSubmit={requestChange} className="space-y-3" aria-busy={busy}>
            <div>
              <Label htmlFor="settings-new-email">New email address</Label>
              <Input
                id="settings-new-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-2 bg-black/20 border-white/15"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || !email.trim()} aria-busy={busy}>
              {busy ? 'Sending code…' : 'Send code to new address'}
            </Button>
          </form>
        ) : (
          <form onSubmit={confirmChange} className="space-y-3" aria-busy={busy}>
            <p aria-live="polite">
              We emailed a 6-digit code to <span className="font-semibold text-white">{email.trim()}</span>.
            </p>
            <div>
              <Label htmlFor="settings-email-code">6-digit code</Label>
              <Input
                id="settings-email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                className="mt-2 bg-black/20 border-white/15 text-center font-mono text-xl tracking-[.4em]"
              />
            </div>
            {challenge?.debugCode && (
              <p className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                Local testing: your code is{' '}
                <span className="font-mono font-bold" data-testid="debug-code">
                  {challenge.debugCode}
                </span>
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button type="submit" disabled={busy || code.length !== 6} aria-busy={busy}>
                {busy ? 'Confirming…' : 'Confirm new email'}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordCard({ user }: { user: User }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const strong = checkPasswordStrength(newPassword, user.email, user.name).valid;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !strong) return;
    setBusy(true);
    setError('');
    try {
      await apiPost('/account/password', { currentPassword, newPassword });
      toast.success('Password updated. Other sessions were signed out.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not update your password.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound size={18} className="text-violet-300" />
          Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3" aria-busy={busy}>
          <div>
            <Label htmlFor="settings-current-password">Current password</Label>
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="mt-2 bg-black/20 border-white/15"
            />
          </div>
          <div>
            <Label htmlFor="settings-new-password">New password</Label>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              aria-describedby="settings-new-password-checklist"
              className="mt-2 bg-black/20 border-white/15"
            />
            <div id="settings-new-password-checklist">
              <PasswordChecklist password={newPassword} email={user.email} name={user.name} />
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <ShieldCheck size={15} className="text-slate-500 shrink-0" aria-hidden="true" />
            <p className="text-xs text-slate-400">Changing your password signs out every other device.</p>
          </div>
          <Button type="submit" disabled={busy || !currentPassword || !strong} aria-busy={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
