import { useEffect, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageLoading } from '../../components/ExperienceStates';
import { usePageMeta } from '../../components/PageMeta';
import { CodeStep, FormError, focusField, useResendCooldown } from '../../components/auth/CodeStep';
import { consumeReturnTo } from '../../lib/api';
import { isSecondFactorChallenge, useAuth, type SecondFactorChallenge, type User } from '../../lib/authContext';
import { errorCode, errorMessage } from '../../lib/errors';

const NOT_ADMIN_MESSAGE = 'This site is only for MusiLynk admins. Sign in to your own account on the MusiLynk website.';

/** The protected page that sent the admin here, if it belongs to this site; otherwise the console. */
function returnDestination(requested: unknown) {
  return typeof requested === 'string' && /^\/(admin|account)(\/|[?#]|$)/.test(requested) ? requested : '/admin';
}

// Admin site sign-in: password first, then the 6-digit code the API emails when the admin's
// second step is on (POST /auth/login answers 202 with a challenge; /auth/second-factor finishes).
export default function AdminSignIn() {
  usePageMeta('Sign in', 'Sign in to the MusiLynk admin console.');
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: restoring, login, completeSecondFactor, logout } = useAuth();
  const [destination] = useState(() =>
    returnDestination((location.state as { from?: unknown } | null)?.from ?? consumeReturnTo()),
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<SecondFactorChallenge | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, startCooldown] = useResendCooldown();

  /* A non-admin session (for example one restored from this browser) has nothing to open here. */
  useEffect(() => {
    if (user && user.role !== 'admin') {
      void logout().catch(() => undefined);
      setError(NOT_ADMIN_MESSAGE);
    }
  }, [user, logout]);

  if (restoring) return <PageLoading label="Checking your admin session" />;
  if (user?.role === 'admin') return <Navigate to={destination} replace />;

  const showPasswordError = (message: string) => {
    setChallenge(null);
    setCode('');
    setError(message);
    window.setTimeout(() => focusField('admin-password'));
  };
  /* A non-admin account is signed out again by the effect above. */
  const finish = (signedIn: User) => {
    if (signedIn.role === 'admin') toast.success('Welcome back');
    else showPasswordError(NOT_ADMIN_MESSAGE);
  };
  const startChallenge = (next: SecondFactorChallenge) => {
    setChallenge(next);
    setCode('');
    setError('');
    startCooldown();
  };

  async function submitPassword(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (isSecondFactorChallenge(result)) startChallenge(result);
      else finish(result);
    } catch (err: unknown) {
      if (challenge) setError(errorMessage(err, 'Could not send a code. Try again.'));
      else showPasswordError(errorMessage(err, 'Could not sign in. Try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(value: string) {
    if (!challenge || loading) return;
    if (value.length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      finish(await completeSecondFactor(challenge.challengeToken, value));
    } catch (err: unknown) {
      /* An expired challenge cannot be retried; the password step starts a new one. */
      if (errorCode(err) === 'SECOND_FACTOR_EXPIRED') showPasswordError(errorMessage(err));
      else {
        setCode('');
        setError(errorMessage(err, 'Invalid or expired code.'));
        focusField('admin-code');
      }
    } finally {
      setLoading(false);
    }
  }

  const passwordForm = (
    <form onSubmit={submitPassword} className="space-y-4" aria-busy={loading}>
      <div>
        <Label htmlFor="admin-email" className="text-slate-200">
          Email
        </Label>
        <Input
          id="admin-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-2 border-white/15"
        />
      </div>
      <div>
        <Label htmlFor="admin-password" className="text-slate-200">
          Password
        </Label>
        <div className="relative mt-2">
          <Input
            id="admin-password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-invalid={Boolean(error)}
            className="border-white/15 pr-12"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-1 top-0 grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:text-white"
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
      <Button disabled={loading} className="w-full border-0 bg-gradient-to-r from-fuchsia-600 to-violet-600">
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-10 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-white/[.03] p-6 shadow-2xl sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/20 text-violet-200">
            <ShieldCheck aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold uppercase tracking-wider text-slate-400">MusiLynk Admin</p>
          <h1 className="mt-1 text-2xl font-black">{challenge ? 'Check your email' : 'Sign in'}</h1>
          {searchParams.get('reason') === 'expired' && (
            <p role="status" data-testid="session-expired" className="mt-2 text-sm text-amber-200">
              Your session expired. Sign in to continue.
            </p>
          )}
        </div>
        {challenge ? (
          <CodeStep
            id="admin-code"
            intro={
              <>
                Admin sign-in needs one more step. We emailed a 6-digit code to{' '}
                <span className="font-semibold text-white">{email}</span>. It expires in 10 minutes.
              </>
            }
            code={code}
            onCodeChange={(value) => {
              setCode(value);
              if (error) setError('');
            }}
            onSubmit={(value) => void confirmCode(value)}
            loading={loading}
            error={error}
            debugCode={challenge.debugCode}
            submitLabel="Verify and sign in"
            backLabel="Back to sign in"
            onBack={() => {
              setChallenge(null);
              setCode('');
              setError('');
            }}
            cooldown={cooldown}
            onResend={() => {
              if (!loading && cooldown <= 0) void submitPassword();
            }}
          />
        ) : (
          passwordForm
        )}
      </div>
    </main>
  );
}
