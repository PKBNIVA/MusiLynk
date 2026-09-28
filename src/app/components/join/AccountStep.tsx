import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Eye, EyeOff, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Field, FormError } from '../form/Field';
import { PasswordChecklist } from '../PasswordChecklist';
import { CODE_LENGTH, CodeStep, focusField, useResendCooldown } from '../auth/CodeStep';
import { apiPost, getSignInMethods, requestSignInCode } from '../../lib/api';
import { useAuth, type User } from '../../lib/authContext';
import { errorCode, errorMessage, errorStatus } from '../../lib/errors';
import { useSubmitOnce } from '../../lib/formErrors';
import { compactStarter, hasStarter, type StarterPayload } from '../../lib/onboarding';
import { checkPasswordStrength } from '../../lib/passwordStrength';

type AccountField = 'name' | 'email' | 'password' | 'consent';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_FIELDS: AccountField[] = ['name', 'email', 'password', 'consent'];

/**
 * The last sign-up step: name, email, then a password or an emailed code (the existing sign-in
 * paths), and the Terms and Privacy Policy box. Creates the account with the earlier answers:
 * sent with the password sign-up, or applied right after a code sign-up.
 */
export function AccountStep({
  role,
  starter,
  onBegin,
  onDone,
}: {
  role: 'jobseeker' | 'employer';
  /** Called just before the account is created (the page stops treating the visitor as signed out). */
  onBegin?: () => void;
  /** The earlier steps' answers, read when the account is created. */
  starter: () => StarterPayload;
  onDone: (user: User) => void;
}) {
  const { register, verifyCode, setUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [consent, setConsent] = useState(false);
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [codesAvailable, setCodesAvailable] = useState(true);
  const [passwordAvailable, setPasswordAvailable] = useState(true);
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState('');
  const [debugCode, setDebugCode] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AccountField, string>>>({});
  const [formError, setFormError] = useState('');
  const [exists, setExists] = useState(false);
  const [cooldown, startCooldown] = useResendCooldown();
  const touched = useRef(false);
  const verifying = useRef(false);
  const submit = useSubmitOnce();

  useEffect(() => {
    let active = true;
    getSignInMethods()
      .then((methods) => {
        if (!active) return;
        if (methods.signInCodes === false && methods.password !== false) {
          setCodesAvailable(false);
          if (!touched.current) setMethod('password');
        }
        if (methods.password === false && methods.signInCodes !== false) {
          setPasswordAvailable(false);
          setMethod('code');
        }
      })
      .catch(() => {
        /* both paths stay offered; each reports its own error */
      });
    return () => {
      active = false;
    };
  }, []);

  const clear = (field: AccountField) => {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setExists(false);
  };

  /** Checks this step; shows every problem and focuses the first. */
  function validate() {
    const next: Partial<Record<AccountField, string>> = {};
    if (name.trim().length < 2) next.name = 'Enter your name (at least 2 letters).';
    if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter your email address, like name@example.com.';
    if (method === 'password' && !checkPasswordStrength(password, email, name).valid)
      next.password = 'Choose a password that meets the checks below.';
    if (!consent) next.consent = 'Tick the box to agree to the Terms and Privacy Policy.';
    setErrors(next);
    const first = ACCOUNT_FIELDS.find((field) => next[field]);
    if (first) focusField(`join-${first}`);
    return !first;
  }

  function showApiError(caught: unknown, fallback: string) {
    if (errorStatus(caught) === 409) {
      setExists(true);
      setErrors({ email: 'An account already exists for this email.' });
      focusField('join-email');
      return;
    }
    const fields = (caught as { fields?: Record<string, string[]> } | null)?.fields ?? {};
    const mine = ACCOUNT_FIELDS.filter((field) => fields[field]?.length);
    if (mine.length) {
      setErrors(Object.fromEntries(mine.map((field) => [field, fields[field][0]])));
      focusField(`join-${mine[0]}`);
    } else setFormError(errorMessage(caught, fallback));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    void submit.run(method === 'password' ? createWithPassword : sendCode);
  }

  async function createWithPassword() {
    onBegin?.();
    setLoading(true);
    setFormError('');
    try {
      const user = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        consent: true,
        ...compactStarter(starter()),
      });
      onDone(user);
    } catch (caught: unknown) {
      showApiError(caught, 'Your account could not be created. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function sendCode() {
    if (cooldown > 0) return;
    setLoading(true);
    setFormError('');
    try {
      const response = await requestSignInCode({ email: email.trim(), name: name.trim(), role, consent: true });
      setDebugCode(response.debugCode);
      setCode('');
      setCodeStep(true);
      startCooldown();
      toast.success('Check your email for a 6-digit code');
    } catch (caught: unknown) {
      if (errorCode(caught) === 'OTP_UNAVAILABLE') {
        setCodesAvailable(false);
        setMethod('password');
        setFormError('Email codes are not available right now. Choose a password instead.');
        focusField('join-password');
      } else showApiError(caught, 'We could not send a code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(value = code) {
    if (verifying.current) return;
    if (value.length !== CODE_LENGTH) {
      setFormError(`Enter the ${CODE_LENGTH}-digit code from your email.`);
      return;
    }
    verifying.current = true;
    onBegin?.();
    setLoading(true);
    setFormError('');
    try {
      let user = await verifyCode(email.trim(), value);
      const answers = compactStarter(starter());
      if (hasStarter(answers)) {
        try {
          const result = await apiPost<{ user?: User }>('/onboarding/starter', { ...answers, consent: true });
          if (result?.user) {
            user = result.user;
            setUser(user);
          }
        } catch {
          toast.error('Your account is ready, but we couldn’t save your answers. Add them from your profile.');
        }
      }
      onDone(user);
    } catch (caught: unknown) {
      setCode('');
      focusField('join-code');
      setFormError(errorMessage(caught, 'That code is wrong or has expired.'));
    } finally {
      verifying.current = false;
      setLoading(false);
    }
  }

  if (codeStep)
    return (
      <CodeStep
        id="join-code"
        intro={
          <>
            We emailed a 6-digit code to <span className="font-semibold text-white">{email.trim()}</span>. It expires in
            10 minutes.
          </>
        }
        code={code}
        onCodeChange={(value) => {
          setCode(value);
          if (formError) setFormError('');
        }}
        onSubmit={(value) => void confirmCode(value)}
        loading={loading}
        error={formError}
        debugCode={debugCode}
        submitLabel="Verify and create my account"
        backLabel="Use a different email"
        onBack={() => {
          setCodeStep(false);
          setCode('');
          setFormError('');
        }}
        cooldown={cooldown}
        onResend={() => void sendCode()}
      />
    );

  const signInPath = `/auth/${role}`;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-busy={loading}>
      <Field id="join-name" label="Your name" error={errors.name}>
        <Input
          autoComplete="name"
          value={name}
          maxLength={120}
          onChange={(event) => {
            setName(event.target.value);
            clear('name');
          }}
          className="border-white/15 bg-black/20"
        />
      </Field>
      <Field id="join-email" label="Email" error={errors.email}>
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clear('email');
          }}
          className="border-white/15 bg-black/20"
        />
      </Field>
      {exists && (
        <p className="text-sm text-slate-300">
          <Link to={signInPath} className="font-semibold text-violet-200 underline underline-offset-4">
            Sign in instead
          </Link>
        </p>
      )}
      {method === 'password' && (
        <Field id="join-password" label="Password" error={errors.password}>
          {(control) => (
            <div>
              <div className="relative">
                <Input
                  {...control}
                  aria-describedby={[control['aria-describedby'], 'join-password-checks'].filter(Boolean).join(' ')}
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clear('password');
                  }}
                  className="border-white/15 bg-black/20 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute right-1 top-0 grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:text-white"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                </button>
              </div>
              <div id="join-password-checks">
                <PasswordChecklist password={password} email={email} name={name} />
              </div>
            </div>
          )}
        </Field>
      )}
      <div>
        <div className="flex items-start gap-3">
          <input
            id="join-consent"
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              clear('consent');
            }}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? 'join-consent-error' : undefined}
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-violet-500"
          />
          <label htmlFor="join-consent" className="text-sm leading-6 text-slate-200">
            I agree to the{' '}
            <Link
              to="/terms"
              target="_blank"
              rel="noopener"
              className="font-semibold text-white underline underline-offset-4"
            >
              Terms
            </Link>{' '}
            and{' '}
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener"
              className="font-semibold text-white underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            .
          </label>
        </div>
        {errors.consent && (
          <p id="join-consent-error" role="alert" className="mt-1.5 text-sm text-rose-300">
            {errors.consent}
          </p>
        )}
      </div>
      <FormError message={formError} />
      <Button
        type="submit"
        size="lg"
        disabled={loading}
        className="w-full border-0 bg-gradient-to-r from-fuchsia-700 to-violet-700 text-base text-white hover:from-fuchsia-600 hover:to-violet-600"
      >
        {method === 'code' && <Mail aria-hidden="true" size={17} />}
        {loading ? 'Just a moment…' : method === 'code' ? 'Email me a code' : 'Create my account'}
      </Button>
      {method === 'code' ? (
        <p className="text-center text-xs leading-5 text-slate-400">
          We email you a 6-digit code. No password to remember.
        </p>
      ) : null}
      {codesAvailable && passwordAvailable && (
        <button
          type="button"
          onClick={() => {
            touched.current = true;
            setMethod(method === 'code' ? 'password' : 'code');
            setErrors({});
            setFormError('');
          }}
          className="min-h-11 w-full text-sm font-medium text-slate-300 hover:text-white"
        >
          {method === 'code' ? 'Use a password instead' : 'Email me a code instead'}
        </button>
      )}
    </form>
  );
}
