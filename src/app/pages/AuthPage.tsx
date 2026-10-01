import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, Link, Navigate } from 'react-router';
import { ArrowLeft, Briefcase, Eye, EyeOff, Mail, ShieldCheck, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { isSecondFactorChallenge, useAuth, type SecondFactorChallenge, type User } from '../lib/authContext';
import { consumeReturnTo, GOOGLE_AUTH_ERROR_MESSAGES, getSignInMethods, requestSignInCode } from '../lib/api';
import { GoogleButton } from '../components/auth/GoogleButton';
import { submitUrgentDraft } from '../lib/urgentDraft';
import { toast } from 'sonner';
import { BrandMark } from '../components/BrandMark';
import { errorCode, errorMessage } from '../lib/errors';
import { useSubmitOnce } from '../lib/formErrors';
import { CODE_LENGTH, CodeStep, FormError, focusField, useResendCooldown } from '../components/auth/CodeStep';
import { usePageMeta } from '../components/PageMeta';

/* Admins use the separate admin site; its address is deliberately not part of this bundle. */
const ADMIN_SITE_MESSAGE = 'Admins sign in at the admin site.';

export default function AuthPage() {
  usePageMeta('Sign in', 'Sign in to your Verse account.', { noindex: true });
  const { userType = 'jobseeker' } = useParams();
  const role = userType === 'employer' ? 'employer' : 'jobseeker';
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, verifyCode, completeSecondFactor, logout } = useAuth();
  // Sign-up lives on the two-minute /join flow; old `?mode=register` links go there (see below).
  const registering = searchParams.get('mode') === 'register';
  const joinPath = role === 'employer' ? '/join/hiring' : '/join/musician';
  /* Email codes are the primary path; passwords remain a fallback until email delivery is proven in production. */
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [codeStep, setCodeStep] = useState<'email' | 'code'>('email');
  /* Set when an admin's password was accepted and the emailed second-step code is still needed. */
  const [challenge, setChallenge] = useState<SecondFactorChallenge | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | undefined>();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, startCooldown] = useResendCooldown();
  /* Until the API says otherwise both paths are offered; an explicit `false` means email cannot be delivered. */
  const [codesAvailable, setCodesAvailable] = useState(true);
  const [emailAvailable, setEmailAvailable] = useState(true);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const touched = useRef(false);
  const focusCode = () => focusField('auth-code');
  const verifying = useRef(false);

  useEffect(() => {
    let active = true;
    getSignInMethods()
      .then((m) => {
        if (!active) return;
        if (m.emailDelivery === false) setEmailAvailable(false);
        if (m.signInCodes === false && m.password !== false) {
          setCodesAvailable(false);
          if (!touched.current) setMethod('password');
        }
        if (m.providers?.google) setGoogleAvailable(true);
      })
      .catch(() => {
        /* keep both paths; the code request reports its own error */
      });
    return () => {
      active = false;
    };
  }, []);

  /* `?auth_error=` on return from "Continue with Google" (see GoogleAuthController). */
  useEffect(() => {
    const code = searchParams.get('auth_error');
    if (!code) return;
    setError(GOOGLE_AUTH_ERROR_MESSAGES[code] ?? "Google didn't complete the sign-in. Try again.");
    const url = new URL(window.location.href);
    url.searchParams.delete('auth_error');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (r: string, complete = true) => {
    const requested = (location.state as { from?: unknown } | null)?.from ?? consumeReturnTo();
    // Role-neutral pages (the Stage) are open to either role, so a deep link to one survives sign-in.
    const allowed =
      typeof requested === 'string' && (requested.startsWith(`/${r}`) || /^\/stage(?:[/?#]|$)/.test(requested));
    navigate(
      allowed
        ? requested
        : r === 'employer'
          ? complete
            ? '/employer'
            : '/employer/profile'
          : complete
            ? '/jobseeker'
            : '/jobseeker/profile',
      { replace: true },
    );
  };
  /* This site has no admin area: an admin session started here (possible while the API's admin
     origin lock is not configured) is ended at once and the admin is told where to go. */
  const finish = async (u: User) => {
    if (u.role === 'admin') {
      await logout().catch(() => undefined);
      leaveChallenge();
      setError(ADMIN_SITE_MESSAGE);
      return;
    }
    // /urgent saved a draft before sending a signed-out hirer to create an account or sign in;
    // post it now and land them on the confirmation/status card instead of the usual destination.
    try {
      const confirmed = await submitUrgentDraft();
      if (confirmed) {
        navigate('/urgent', { replace: true, state: { confirmed } });
        return;
      }
    } catch (e: unknown) {
      toast.error(
        errorMessage(e, 'Signed in, but the urgent request could not be posted. Please try again from /urgent.'),
      );
    }
    go(u.role, u.profileComplete);
  };
  /* Errors are shown inline (role=alert) next to the fields, for both the code and password flows. */
  const fail = (e: unknown, fallback: string) => setError(errorMessage(e, fallback));
  const switchMethod = (next: 'code' | 'password') => {
    touched.current = true;
    setMethod(next);
    setCodeStep('email');
    setCode('');
    setError('');
    setChallenge(null);
  };
  const leaveChallenge = () => {
    setChallenge(null);
    setCodeStep('email');
    setCode('');
    setDebugCode(undefined);
    setError('');
  };
  const startChallenge = (next: SecondFactorChallenge) => {
    setChallenge(next);
    setDebugCode(next.debugCode);
    setCode('');
    setError('');
    setCodeStep('code');
    startCooldown();
    toast.success('Check your email for a 6-digit code');
  };

  /* Ref-based guard: rapid clicks on Sign in / Create account send one request (FORM-22). */
  const passwordSubmit = useSubmitOnce();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    void passwordSubmit.run(submitPassword);
  }
  async function submitPassword() {
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (isSecondFactorChallenge(result)) {
        startChallenge(result);
        return;
      }
      await finish(result);
    } catch (e: unknown) {
      /* The API refuses admin passwords from this site once the admin site is live. */
      if (errorCode(e) === 'ADMIN_USE_ADMIN_SITE') setError(errorMessage(e, ADMIN_SITE_MESSAGE));
      else {
        /* Inline, announced, next to the fields; focus goes to the field to fix (FORM-08). */
        setError(errorMessage(e, 'Unable to continue'));
        focusField('auth-password');
      }
    } finally {
      setLoading(false);
    }
  }

  /* A new admin challenge needs the password step again; it emails a fresh code. */
  async function resendChallenge() {
    if (loading || cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (isSecondFactorChallenge(result)) startChallenge(result);
    } catch (e: unknown) {
      fail(e, 'Could not send a code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (challenge) return resendChallenge();
    if (loading || cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      const response = await requestSignInCode({ email });
      setDebugCode(response.debugCode);
      setCode('');
      setCodeStep('code');
      startCooldown();
      toast.success('Check your email for a 6-digit code');
    } catch (e: unknown) {
      if (errorCode(e) === 'OTP_UNAVAILABLE') {
        setCodesAvailable(false);
        setMethod('password');
        toast.error(errorMessage(e));
      } else fail(e, 'Could not send a code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(value = code) {
    if (verifying.current) return;
    if (value.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }
    verifying.current = true;
    setLoading(true);
    setError('');
    try {
      const u = challenge
        ? await completeSecondFactor(challenge.challengeToken, value)
        : await verifyCode(email, value);
      await finish(u);
    } catch (e: unknown) {
      /* An expired or unusable challenge cannot be retried; start again from the password. */
      if (challenge && errorCode(e) === 'SECOND_FACTOR_EXPIRED') {
        leaveChallenge();
        toast.error(errorMessage(e));
        return;
      }
      setCode('');
      focusCode();
      fail(e, 'Invalid or expired code.');
    } finally {
      verifying.current = false;
      setLoading(false);
    }
  }

  const onCodeChange = (value: string) => {
    setCode(value);
    if (error) setError('');
  };

  const inputClass = 'mt-2 border-white/15';
  const emailField = (
    <div>
      <Label htmlFor="auth-email" className="text-slate-200">
        Email
      </Label>
      <Input
        id="auth-email"
        aria-label="Email"
        autoComplete="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        className={inputClass}
      />
    </div>
  );
  const errorBox = error && <FormError>{error}</FormError>;

  const codeForms =
    codeStep === 'email' ? (
      <form onSubmit={sendCode} className="space-y-4" aria-busy={loading}>
        {emailField}
        {errorBox}
        <Button disabled={loading} className="w-full border-0 bg-gradient-to-r from-fuchsia-600 to-violet-600">
          <Mail className="mr-2 h-4 w-4" />
          {loading ? 'Sending code…' : 'Email me a sign-in code'}
        </Button>
        <p className="text-center text-xs leading-5 text-slate-400">
          We’ll email you a 6-digit code. No password needed.
        </p>
      </form>
    ) : (
      <CodeStep
        intro={
          challenge ? (
            <>
              Admin sign-in needs one more step. We emailed a 6-digit code to{' '}
              <span className="font-semibold text-white">{email}</span>. It expires in 10 minutes.
            </>
          ) : (
            <>
              If <span className="font-semibold text-white">{email}</span> can be used on Verse, a 6-digit code is on
              its way. It expires in 10 minutes.
            </>
          )
        }
        code={code}
        onCodeChange={onCodeChange}
        onSubmit={(value) => void confirmCode(value)}
        loading={loading}
        error={error}
        debugCode={debugCode}
        submitLabel="Verify and sign in"
        backLabel={challenge ? 'Back to sign in' : 'Use a different email'}
        onBack={() => {
          if (challenge) {
            leaveChallenge();
            return;
          }
          setCodeStep('email');
          setCode('');
          setError('');
        }}
        cooldown={cooldown}
        onResend={() => void sendCode()}
      />
    );

  const passwordForm = (
    <form onSubmit={submit} className="space-y-4">
      {emailField}
      <div>
        <Label htmlFor="auth-password" className="text-slate-200">
          Password
        </Label>
        <div className="relative mt-2">
          <Input
            id="auth-password"
            aria-label="Password"
            autoComplete="current-password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'auth-password-error' : undefined}
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
      {error && (
        <div id="auth-password-error">
          <FormError>{error}</FormError>
        </div>
      )}
      <Button disabled={loading} className="w-full border-0 bg-gradient-to-r from-fuchsia-600 to-violet-600">
        {loading ? 'Tuning your workspace…' : 'Sign in'}
      </Button>
    </form>
  );

  if (registering) return <Navigate to={joinPath} state={location.state} replace />;
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 px-5 py-8 text-white">
      <div className="verse-grid absolute inset-0" />
      <div className="verse-orb absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/45" />
      <div className="verse-orb absolute -bottom-40 -right-20 h-[34rem] w-[34rem] rounded-full bg-cyan-400/25" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between">
          <Link to="/">
            <BrandMark />
          </Link>
          <Link to="/" className="inline-flex items-center text-sm text-slate-300 hover:text-white">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to home
          </Link>
        </header>
        <main className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-[1fr_480px]">
          <div className="hidden lg:block">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.05] px-3 py-1.5 text-sm text-slate-300">
              <ShieldCheck size={15} className="text-emerald-300" />
              Your account and work stay protected
            </div>
            <h1 className="mt-6 max-w-xl text-6xl font-black leading-[1] tracking-[-.05em]">
              One login. Your whole <span className="verse-gradient-text">music world.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-slate-300">
              Discover work, prove your craft, build teams and manage every conversation in one professional home.
            </p>
          </div>
          {/* A CSS fade-in (the global reduced-motion rule shortens it); the motion library cost ~42 kB gzip for this alone. */}
          <div className="animate-in fade-in-0 slide-in-from-bottom-4 duration-500">
            <Card className="verse-surface border-white/15 bg-transparent shadow-2xl">
              <CardHeader className="text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500/30 to-violet-500/25 text-violet-200">
                  {role === 'employer' ? <Briefcase /> : <Users />}
                </div>
                <CardTitle level={2} className="mt-2 text-2xl font-black text-white">
                  {(method === 'code' || challenge) && codeStep === 'code' ? 'Check your email' : 'Welcome back'}
                </CardTitle>
                <CardDescription className="text-slate-300">
                  {role === 'employer'
                    ? 'Hire music talent and manage every candidate'
                    : 'Find work and build a career people can hear'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {codeStep === 'email' && (
                  <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/10 bg-black/15 p-1">
                    <Link
                      to="/auth/jobseeker"
                      className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${role === 'jobseeker' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                    >
                      <Users size={15} />
                      Professional
                    </Link>
                    <Link
                      to="/auth/employer"
                      className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${role === 'employer' ? 'bg-white/10 text-white' : 'text-slate-400'}`}
                    >
                      <Briefcase size={15} />
                      Employer
                    </Link>
                  </div>
                )}
                {codeStep === 'email' && !challenge && googleAvailable && <GoogleButton intent="signin" role={role} />}
                {method === 'code' || challenge ? codeForms : passwordForm}
                {codeStep === 'email' && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    {(method === 'code' || codesAvailable) && (
                      <button
                        type="button"
                        onClick={() => switchMethod(method === 'code' ? 'password' : 'code')}
                        className="min-h-11 text-sm text-slate-300 hover:text-white"
                      >
                        {method === 'code' ? 'Use password instead' : 'Email me a code instead'}
                      </button>
                    )}
                    {method === 'password' && emailAvailable && (
                      <Link to="/forgot-password" className="text-xs text-slate-400 hover:text-white">
                        Forgot password?
                      </Link>
                    )}
                  </div>
                )}
                {codeStep === 'email' && (
                  <Link
                    to={joinPath}
                    state={location.state}
                    className="mt-3 flex min-h-11 w-full items-center justify-center text-sm font-semibold text-violet-200 hover:text-white"
                  >
                    New to Verse? Join in two minutes
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
