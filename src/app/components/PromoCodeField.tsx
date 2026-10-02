import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Sparkles } from 'lucide-react';
import { ApiError, apiPost } from '../lib/api';
import type { BillingInterval, Plan, PromoValidation } from '../lib/apiTypes';
import { describeEffect, normaliseCode, storeCode } from '../lib/promo';
import { errorMessage } from '../lib/errors';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Line = { plan: Plan; result: PromoValidation };
type Status =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'signedOut' }
  | { state: 'error'; message: string }
  | { state: 'done'; lines: Line[] };

/**
 * "Have a code?" on the pricing page: an inline field that checks the code against every paid
 * plan on blur or Enter, and says what it does (or why it cannot be used). Signed out, the code
 * is kept in sessionStorage and checked once the person has signed in. `onApplied` reports the
 * code the call-to-action should carry to checkout ('' when there is none worth carrying).
 */
export function PromoCodeField({
  plans,
  interval,
  initialCode = '',
  onApplied,
}: {
  plans: Plan[];
  interval: BillingInterval;
  initialCode?: string;
  onApplied: (code: string) => void;
}) {
  const [open, setOpen] = useState(!!initialCode);
  const [value, setValue] = useState(initialCode);
  const [checked, setChecked] = useState(''); // the code the current status is about
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const seq = useRef(0);
  const paid = plans.filter((p) => p.code !== 'free' && p.code !== 'enterprise' && p.monthly);
  const paidKey = paid.map((p) => p.code).join(',');

  const validate = useCallback(
    async (raw: string) => {
      const code = normaliseCode(raw);
      const id = ++seq.current;
      setChecked(code);
      if (!code) {
        setStatus({ state: 'idle' });
        storeCode('');
        onApplied('');
        return;
      }
      setStatus({ state: 'checking' });
      try {
        const lines: Line[] = await Promise.all(
          paid.map(async (plan) => ({
            plan,
            result: await apiPost<PromoValidation>(
              '/billing/codes/validate',
              { code, planCode: plan.code, interval },
              { skipAuthRedirect: true },
            ),
          })),
        );
        if (id !== seq.current) return;
        setStatus({ state: 'done', lines });
        storeCode(lines.some((l) => l.result.valid) ? code : '');
        onApplied(lines.some((l) => l.result.valid) ? code : '');
      } catch (e: unknown) {
        if (id !== seq.current) return;
        if (e instanceof ApiError && e.status === 401) {
          // Not signed in yet: keep the code for after sign-in, where it is checked and applied.
          storeCode(code);
          onApplied(code);
          setStatus({ state: 'signedOut' });
        } else {
          onApplied('');
          setStatus({ state: 'error', message: errorMessage(e, 'We could not check that code. Try again.') });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `paid` is captured through paidKey
    [interval, paidKey, onApplied],
  );

  // A prefilled code (?code= or the one kept across sign-in) is checked as soon as plans are known,
  // and again whenever the interval changes, since a code can be limited to one interval.
  useEffect(() => {
    if (checked && paid.length) void validate(checked);
    else if (!checked && initialCode && paid.length) void validate(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run for a new interval or plan list only
  }, [interval, paidKey]);

  if (!open) {
    return (
      <div className="mt-4 text-center">
        <button
          type="button"
          className="min-h-10 px-2 text-sm text-violet-300 underline underline-offset-4 hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 rounded"
          onClick={() => setOpen(true)}
        >
          Have a code?
        </button>
      </div>
    );
  }

  const lines = status.state === 'done' ? status.lines : [];
  const seen = new Set<string>();
  return (
    <div className="mt-4 mx-auto max-w-md text-left" data-testid="promo-field">
      <Label htmlFor="promo-code" className="text-sm text-slate-300 flex items-center gap-1.5">
        <Sparkles size={14} aria-hidden="true" className="text-violet-300" />
        Promo or referral code
      </Label>
      <Input
        id="promo-code"
        value={value}
        autoFocus={!initialCode}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={40}
        placeholder="e.g. VERSE-K7M2QP"
        className="mt-1.5 bg-white/5 border-white/15 uppercase"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (normaliseCode(value) !== checked) void validate(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void validate(value);
          }
        }}
      />
      <div className="mt-2 space-y-1 text-sm min-h-5" role="status" aria-live="polite" data-testid="promo-result">
        {status.state === 'checking' && <p className="text-slate-400">Checking code…</p>}
        {status.state === 'signedOut' && (
          <p className="text-slate-300">Sign in and we'll check this code. It's saved for checkout.</p>
        )}
        {status.state === 'error' && <p className="text-rose-300">{status.message}</p>}
        {lines.map(({ plan, result }) => {
          const text = result.valid ? describeEffect(plan, interval, result) || result.message : result.message;
          const key = `${result.valid}:${text}`;
          if (seen.has(key)) return null;
          seen.add(key);
          return result.valid ? (
            <p key={plan.code} className="flex items-start gap-1.5 text-emerald-300">
              <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              {text}
            </p>
          ) : (
            <p key={plan.code} className="flex items-start gap-1.5 text-rose-300">
              <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              {text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
