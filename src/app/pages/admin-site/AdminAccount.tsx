import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, CheckCircle2, LogOut, Mail, UserCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { usePageMeta } from '../../components/PageMeta';
import { CodeStep, FormError, focusField, useResendCooldown } from '../../components/auth/CodeStep';
import {
  changeAdminPassword,
  confirmAdminEmailChange,
  requestAdminEmailChange,
  secondFactorGap,
} from '../../lib/adminAccount';
import type { AdminEmailChangeStarted } from '../../lib/apiTypes';
import { useAuth } from '../../lib/authContext';
import { errorCode, errorMessage } from '../../lib/errors';
import { useAdminSite } from './AdminSiteLayout';

const MIN_PASSWORD = 10;
const section = 'rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6';
const submitClass = 'border-0 bg-gradient-to-r from-fuchsia-600 to-violet-600';
const success = 'rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100';

function EmailChange() {
  const { setUser } = useAuth();
  const { reloadAccount } = useAdminSite();
  const [email, setEmail] = useState('');
  const [started, setStarted] = useState<AdminEmailChangeStarted | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [cooldown, startCooldown] = useResendCooldown();

  const backToEmail = (message = '') => {
    setStarted(null);
    setCode('');
    setError(message);
    window.setTimeout(() => focusField('admin-new-email'));
  };

  async function request(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setDone('');
    try {
      setStarted(await requestAdminEmailChange(email.trim()));
      setCode('');
      startCooldown();
    } catch (err: unknown) {
      /* EMAIL_UNDELIVERABLE, EMAIL_TAKEN, invalid format or the hourly limit: all fixable in the field. */
      if (started) setError(errorMessage(err, 'Could not send a code. Try again.'));
      else backToEmail(errorMessage(err, 'Could not send a code. Try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function confirmChange(value: string) {
    if (!started || loading) return;
    setLoading(true);
    setError('');
    try {
      const { user } = await confirmAdminEmailChange(started.changeToken, value);
      setUser(user);
      setStarted(null);
      setEmail('');
      setCode('');
      setDone(`Your admin email is now ${user.email}. Your other admin sessions were signed out.`);
      toast.success('Admin email changed');
      await reloadAccount();
    } catch (err: unknown) {
      /* An expired change cannot be finished; a new request emails a fresh code. */
      if (/EXPIRED/.test(errorCode(err) ?? '')) backToEmail(errorMessage(err));
      else {
        setCode('');
        setError(errorMessage(err, 'Invalid or expired code.'));
        focusField('admin-email-code');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="change-email-title" className={section}>
      <h2 id="change-email-title" className="text-lg font-bold">
        Change your admin email
      </h2>
      <p className="mt-1 text-sm text-slate-400">
        Sign-in codes go to this address, so use a mailbox you check. We email a code to the new address to prove it
        works before switching.
      </p>
      <div className="mt-4">
        {started ? (
          <CodeStep
            id="admin-email-code"
            label="Confirmation code"
            intro={
              <>
                We emailed a 6-digit code to <span className="font-semibold text-white">{email.trim()}</span>. It
                expires in {Math.round(started.expiresIn / 60)} minutes.
              </>
            }
            code={code}
            onCodeChange={(value) => {
              setCode(value);
              if (error) setError('');
            }}
            onSubmit={(value) => void confirmChange(value)}
            loading={loading}
            error={error}
            debugCode={started.debugCode}
            submitLabel="Confirm new email"
            backLabel="Use a different email"
            onBack={() => backToEmail()}
            cooldown={cooldown}
            onResend={() => {
              if (!loading && cooldown <= 0) void request();
            }}
          />
        ) : (
          <form onSubmit={request} className="space-y-4" aria-busy={loading}>
            <div>
              <Label htmlFor="admin-new-email" className="text-slate-200">
                New email address
              </Label>
              <Input
                id="admin-new-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                required
                aria-invalid={Boolean(error)}
                className="mt-2 border-white/15"
              />
            </div>
            {error && <FormError>{error}</FormError>}
            {done && (
              <p role="status" className={success}>
                {done}
              </p>
            )}
            <Button disabled={loading} className={submitClass}>
              <Mail aria-hidden="true" className="mr-2 h-4 w-4" />
              {loading ? 'Sending code…' : 'Email me a code'}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function PasswordChange() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [done, setDone] = useState(false);

  const fail = (field: string, message: string) => {
    setError({ field, message });
    focusField(field);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setDone(false);
    if (next.length < MIN_PASSWORD)
      return fail('admin-new-password', `Use at least ${MIN_PASSWORD} characters for the new password.`);
    if (next !== again) return fail('admin-confirm-password', 'The new passwords do not match.');
    setLoading(true);
    setError(null);
    try {
      await changeAdminPassword(current, next);
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(true);
      toast.success('Password changed');
    } catch (err: unknown) {
      fail('admin-current-password', errorMessage(err, 'Could not change the password. Try again.'));
    } finally {
      setLoading(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div>
      <Label htmlFor={id} className="text-slate-200">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          if (error?.field === id) setError(null);
        }}
        required
        minLength={id === 'admin-current-password' ? undefined : MIN_PASSWORD}
        aria-invalid={error?.field === id}
        aria-describedby={id === 'admin-new-password' ? 'admin-new-password-help' : undefined}
        className="mt-2 border-white/15"
      />
      {id === 'admin-new-password' && (
        <p id="admin-new-password-help" className="mt-1.5 text-xs text-slate-400">
          At least {MIN_PASSWORD} characters. A longer passphrase is easiest to remember.
        </p>
      )}
    </div>
  );

  return (
    <section aria-labelledby="change-password-title" className={section}>
      <h2 id="change-password-title" className="text-lg font-bold">
        Change your password
      </h2>
      <p className="mt-1 text-sm text-slate-400">Your other admin sessions are signed out when the password changes.</p>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4" aria-busy={loading}>
        {field('admin-current-password', 'Current password', current, setCurrent, 'current-password')}
        {field('admin-new-password', 'New password', next, setNext, 'new-password')}
        {field('admin-confirm-password', 'Confirm new password', again, setAgain, 'new-password')}
        {error && <FormError>{error.message}</FormError>}
        {done && (
          <p role="status" className={success}>
            Password changed. Your other admin sessions were signed out.
          </p>
        )}
        <Button disabled={loading} className={submitClass}>
          {loading ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </section>
  );
}

export default function AdminAccount() {
  usePageMeta('Your admin account', 'Your MusiLynk admin email, two-step sign-in and password.');
  const { user, logout } = useAuth();
  const { account, accountError, reloadAccount } = useAdminSite();
  const navigate = useNavigate();
  const gap = account && secondFactorGap(account);

  return (
    <div className="min-h-screen bg-slate-950/95 text-white">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/admin" className="inline-flex min-h-11 items-center text-sm text-slate-300 hover:text-white">
            <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
            Back to the console
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            <LogOut aria-hidden="true" className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <UserCircle2 aria-hidden="true" className="text-violet-300" />
          Your admin account
        </h1>

        <section aria-labelledby="admin-email-title" className={section}>
          <h2 id="admin-email-title" className="text-lg font-bold">
            Your admin email
          </h2>
          <p className="mt-2 break-all font-mono text-base" data-testid="admin-current-email">
            {account?.email ?? user?.email}
          </p>
          {account ? (
            <div className="mt-3 space-y-2 text-sm">
              {account.emailDeliverable ? (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 font-semibold text-emerald-200">
                  <CheckCircle2 aria-hidden="true" size={15} />
                  Can receive email
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5 rounded-full bg-rose-400/15 px-2.5 py-1 font-semibold text-rose-200">
                  <XCircle aria-hidden="true" size={15} />
                  Cannot receive email
                </p>
              )}
              <p className="text-slate-300">
                {gap
                  ? `Two-step sign-in is off for your account because ${gap}.`
                  : 'Two-step sign-in is on: each sign-in needs your password and a code emailed to this address.'}
              </p>
            </div>
          ) : accountError ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <FormError>{accountError}</FormError>
              <Button variant="outline" size="sm" onClick={() => void reloadAccount()}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400" role="status">
              Checking whether this address can receive email…
            </p>
          )}
        </section>

        <EmailChange />
        <PasswordChange />
      </main>
    </div>
  );
}
