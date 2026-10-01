import { usePageMeta } from '../components/PageMeta';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PublicNav } from '../components/PublicNav';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { apiGet, apiPost, setAccessToken } from '../lib/api';
import { useAuth, type Role, type User } from '../lib/authContext';
import { toast } from 'sonner';
import { errorMessage } from '../lib/errors';
import { checkPasswordStrength } from '../lib/passwordStrength';

type CheckState = 'checking' | 'valid' | 'invalid';

/** FORM-15: the link is checked before anyone types a new password, so an expired or
 * already-used link says so immediately, with a form to request a new one right there.
 * A successful reset signs the person straight in and sends them to their role's home. */
export default function ResetPassword() {
  usePageMeta('Choose a new password', 'Set a new password for your Verse account using the link from your email.', {
    noindex: true,
  });
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [check, setCheck] = useState<CheckState>('checking');
  const [role, setRole] = useState<Role>('jobseeker');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendDone, setResendDone] = useState(false);
  const [done, setDone] = useState(false);
  const strong = checkPasswordStrength(password).valid;

  useEffect(() => {
    let active = true;
    if (!token) {
      setCheck('invalid');
      return;
    }
    apiGet<{ valid: boolean; role?: Role }>(`/auth/reset-password/check?token=${encodeURIComponent(token)}`)
      .then((d) => {
        if (!active) return;
        if (d.valid) {
          setRole(d.role || 'jobseeker');
          setCheck('valid');
        } else {
          setCheck('invalid');
        }
      })
      .catch(() => {
        if (active) setCheck('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !strong) return;
    setBusy(true);
    setError('');
    try {
      const d = await apiPost<{ ok: boolean; user?: User; accessToken?: string; signInRequired?: boolean }>(
        '/auth/reset-password',
        { token, password },
      );
      /* Admins (and anyone else the API does not sign in) get no token: send them to sign in. */
      if (d.signInRequired || !d.accessToken || !d.user) {
        setDone(true);
        return;
      }
      setAccessToken(d.accessToken);
      setUser(d.user);
      toast.success('Password updated. You are signed in.');
      navigate(d.user.profileComplete ? `/${d.user.role}` : `/${d.user.role}/profile`, { replace: true });
    } catch (err: unknown) {
      const message = errorMessage(err, 'This link has expired or was already used. Request a new one.');
      setError(message);
      if (message.toLowerCase().includes('expired') || message.toLowerCase().includes('already used')) {
        setCheck('invalid');
      }
    } finally {
      setBusy(false);
    }
  }

  async function requestNewLink(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await apiPost('/auth/forgot-password', { email: resendEmail });
      setResendDone(true);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PublicNav />
      <main className="max-w-md mx-auto px-5 py-24">
        <h1 className="text-4xl font-bold">Choose a new password</h1>

        {done && (
          <div className="mt-6 space-y-5">
            <p role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-emerald-100">
              {role === 'admin'
                ? 'Password updated. Admins sign in at the admin site.'
                : 'Password updated. Sign in with your new password.'}
            </p>
            {role !== 'admin' && (
              <Button asChild className="w-full">
                <Link to={`/auth/${role}`}>Sign in</Link>
              </Button>
            )}
          </div>
        )}

        {!done && check === 'checking' && (
          <p className="text-slate-400 mt-3" aria-live="polite">
            Checking your link…
          </p>
        )}

        {!done && check === 'invalid' && (
          <div className="mt-6 space-y-5">
            <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
              This link has expired or was already used. Request a new one below.
            </p>
            {resendDone ? (
              <p className="text-slate-400" role="status">
                If an account exists, a new reset link has been sent.
              </p>
            ) : (
              <form onSubmit={requestNewLink} className="space-y-3" aria-busy={busy}>
                <Label htmlFor="resend-email" className="text-slate-200">
                  Email
                </Label>
                <Input
                  id="resend-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  className="bg-white/5 border-white/15"
                />
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Sending…' : 'Send a new link'}
                </Button>
              </form>
            )}
            <Button variant="outline" asChild className="w-full">
              <Link to="/auth/jobseeker">Sign in</Link>
            </Button>
          </div>
        )}

        {!done && check === 'valid' && (
          <form onSubmit={submit} className="mt-6 space-y-3" aria-busy={busy}>
            <Label htmlFor="reset-password" className="text-slate-200">
              New password
            </Label>
            <Input
              id="reset-password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              aria-describedby="reset-password-help"
              className="bg-white/5 border-white/15"
            />
            <div id="reset-password-help">
              <PasswordChecklist password={password} />
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-rose-200">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !strong}>
              {busy ? 'Updating…' : 'Update password'}
            </Button>
            <p className="text-center text-xs text-slate-400">
              <Link to={`/auth/${role}`} className="hover:text-white underline">
                Sign in
              </Link>{' '}
              instead
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
