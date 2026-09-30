import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Camera, KeyRound, Link2, Mail, MessageCircle, ShieldCheck, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Navigation } from '../components/Navigation';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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
import { PasswordChecklist } from '../components/PasswordChecklist';
import { UserAvatar } from '../components/kit/UserAvatar';
import { cropSquare } from '../components/media/cropSquare';
import { GoogleButton } from '../components/auth/GoogleButton';
import {
  apiPatch,
  apiPost,
  apiPut,
  disconnectAuthConnection,
  getSignInMethods,
  uploadMedia,
  type AuthConnectionSummary,
} from '../lib/api';
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
        <PageHeader
          title="Account settings"
          actions={
            <Link to={`${baseUrl}/account`} className="text-sm text-slate-400 underline hover:text-white">
              Your data &amp; account
            </Link>
          }
        />

        {user && <NameCard user={user} onSaved={setUser} />}
        {user && <PhotoCard user={user} onSaved={setUser} />}
        {user && <EmailCard user={user} onSaved={setUser} />}
        {user?.role === 'jobseeker' && <WhatsAppCard user={user} />}
        {user && <PasswordCard user={user} />}
        {user && <SignInMethodsCard />}
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

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Profile photo: pick a picture, it is cropped to a 512 px square in the browser, uploaded and saved. */
function PhotoCard({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function save(photoUrl: string) {
    const d = await apiPut<{ user: User }>('/profile', { photoUrl });
    onSaved({ ...user, ...d.user });
  }

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      toast.error('Choose a JPEG, PNG or WebP picture.');
      return;
    }
    setBusy(true);
    try {
      const cropped = await cropSquare(file);
      const stored = await uploadMedia(cropped);
      await save(stored.url);
      toast.success('Photo updated');
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not update your photo. Try a smaller JPEG, PNG or WebP picture.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await save('');
      toast.success('Photo removed');
    } catch (err: unknown) {
      toast.error(errorMessage(err, 'Could not remove your photo. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera size={18} className="text-violet-300" />
          Photo
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4" aria-busy={busy}>
          <UserAvatar id={user.id} name={user.name} size="xl" photoUrl={user.photoUrl} decorative={false} />
          <div className="space-y-2">
            <p className="text-sm text-slate-300">JPEG, PNG or WebP. It is cropped to a square.</p>
            <input
              ref={input}
              id="settings-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={choose}
              aria-label="Choose a photo"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-busy={busy}
                onClick={() => input.current?.click()}
              >
                {busy ? 'Saving…' : user.photoUrl ? 'Change photo' : 'Upload photo'}
              </Button>
              {user.photoUrl && (
                <Button type="button" variant="outline" disabled={busy} onClick={remove}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
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

// "Need someone by tomorrow" urgent alerts, on top of the in-app + email alert everyone
// already gets. Off unless a number is entered AND the box is ticked; see WhatsappAlerts.
function WhatsAppCard({ user }: { user: User }) {
  const [phone, setPhone] = useState(user.phoneE164 || '');
  const [consent, setConsent] = useState(Boolean(user.whatsappConsentedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = phone !== (user.phoneE164 || '') || consent !== Boolean(user.whatsappConsentedAt);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError('');
    try {
      await apiPost('/profile/whatsapp-consent', { phoneE164: phone.trim(), consent });
      toast.success(consent ? 'WhatsApp urgent alerts turned on' : 'WhatsApp urgent alerts turned off');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not save this.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="bg-white/[.055] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle size={18} className="text-violet-300" />
          Get urgent alerts on WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-400 mb-4">
          When a "need someone by tomorrow" request matches your roles and city, you'll always get an in-app and email
          alert. Add your number and turn this on to also get it on WhatsApp, so you can respond even faster.
        </p>
        <form onSubmit={save} className="space-y-3" aria-busy={busy}>
          <div>
            <Label htmlFor="settings-whatsapp-phone">WhatsApp number (with country code)</Label>
            <Input
              id="settings-whatsapp-phone"
              type="tel"
              placeholder="+919812345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-2 bg-black/20 border-white/15"
            />
          </div>
          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-4 rounded border-white/30 bg-black/20"
            />
            Send me urgent-hire alerts on WhatsApp at this number.
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !dirty} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </form>
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

/** Google (and, later, other providers) as an alternate sign-in method: connect, or
 * disconnect with a confirm dialog. Hidden entirely when Google sign-in is not configured. */
function SignInMethodsCard() {
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [connections, setConnections] = useState<AuthConnectionSummary[]>([]);
  const [pendingRemove, setPendingRemove] = useState<AuthConnectionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    getSignInMethods()
      .then((methods) => {
        setGoogleAvailable(Boolean(methods.providers?.google));
        setConnections(methods.connections ?? []);
      })
      .catch(() => {
        /* the card just stays hidden/empty; nothing else on the page depends on it */
      });
  };
  useEffect(load, []);

  const google = connections.find((c) => c.provider === 'google');

  async function disconnect() {
    if (!pendingRemove || busy) return;
    setBusy(true);
    try {
      await disconnectAuthConnection(pendingRemove.id);
      toast.success('Google disconnected');
      setPendingRemove(null);
      load();
    } catch (e: unknown) {
      toast.error(errorMessage(e, 'Could not disconnect. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!googleAvailable && connections.length === 0) return null;

  return (
    <Card className="bg-white/[.03] border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 size={18} className="text-violet-300" aria-hidden="true" />
          Sign-in methods
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.02] p-4">
          <div>
            <div className="font-medium">Google</div>
            <div className="text-sm text-slate-400">
              {google ? `Connected as ${google.email ?? google.displayName ?? 'your Google account'}` : 'Not connected'}
            </div>
          </div>
          {google ? (
            <Button variant="outline" onClick={() => setPendingRemove(google)}>
              Disconnect
            </Button>
          ) : googleAvailable ? (
            <GoogleButton intent="connect" showDivider={false} />
          ) : null}
        </div>
      </CardContent>

      <AlertDialog open={Boolean(pendingRemove)} onOpenChange={(open) => !open && setPendingRemove(null)}>
        <AlertDialogContent className="bg-slate-900 text-white border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              You will no longer be able to sign in to Verse with this Google account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-slate-900">Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-500" onClick={() => void disconnect()}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
