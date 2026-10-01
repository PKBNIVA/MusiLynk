import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

// The 6-digit emailed-code step shared by email sign-in, the admin second sign-in step and the
// admin email change: one-time-code autofill, numeric keypad, auto-submit on the last digit or a
// paste, inline role=alert errors that refocus the field, and a resend link with a cooldown.

export const CODE_LENGTH = 6;
export const RESEND_COOLDOWN_SECONDS = 60;
export const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, CODE_LENGTH);

/** Seconds left before another code may be requested, and a setter that starts the countdown. */
export function useResendCooldown(): [number, (seconds?: number) => void] {
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  return [cooldown, (seconds = RESEND_COOLDOWN_SECONDS) => setCooldown(seconds)];
}

/** Input does not forward refs, so the code field is focused by id. */
export const focusField = (id: string) => document.getElementById(id)?.focus();

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
      {children}
    </p>
  );
}

const linkButton = 'min-h-11 text-sm font-semibold text-violet-200 hover:text-white disabled:text-slate-500';

export interface CodeStepProps {
  /** Explains where the code went; announced politely when the step opens. */
  intro: ReactNode;
  code: string;
  /** Receives the digits only (at most CODE_LENGTH). */
  onCodeChange: (value: string) => void;
  /** Called on submit and automatically once all digits are entered. */
  onSubmit: (value: string) => void;
  loading: boolean;
  error: string;
  submitLabel: string;
  backLabel: string;
  onBack: () => void;
  cooldown: number;
  onResend: () => void;
  /** Shown only when the API returns it (local development without an email provider). */
  debugCode?: string;
  id?: string;
  label?: string;
}

export function CodeStep({
  intro,
  code,
  onCodeChange,
  onSubmit,
  loading,
  error,
  submitLabel,
  backLabel,
  onBack,
  cooldown,
  onResend,
  debugCode,
  id = 'auth-code',
  label = 'Sign-in code',
}: CodeStepProps) {
  const helpId = `${id}-help`;
  useEffect(() => {
    focusField(id);
  }, [id]);

  const change = (raw: string) => {
    const value = digitsOnly(raw);
    onCodeChange(value);
    /* Typing or pasting the last digit submits, so a pasted code works in one step. */
    if (value.length === CODE_LENGTH && !loading) onSubmit(value);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
      }}
      className="space-y-4"
      aria-busy={loading}
    >
      <p className="text-sm leading-6 text-slate-300" aria-live="polite">
        {intro}
      </p>
      <div>
        <Label htmlFor={id} className="text-slate-200">
          {label}
        </Label>
        <Input
          id={id}
          aria-label={label}
          value={code}
          onChange={(e) => change(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            change(e.clipboardData.getData('text'));
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={CODE_LENGTH}
          placeholder="••••••"
          aria-invalid={Boolean(error)}
          aria-describedby={helpId}
          readOnly={loading}
          className="mt-2 border-white/15 text-center font-mono text-2xl tracking-[.5em]"
        />
        <p id={helpId} className="mt-1.5 text-xs text-slate-400">
          Paste or type the code from your email.
        </p>
      </div>
      {debugCode && (
        <p className="rounded-lg border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          Email is switched off here, so your code is{' '}
          <span className="font-mono font-bold" data-testid="debug-code">
            {debugCode}
          </span>
        </p>
      )}
      {error && <FormError>{error}</FormError>}
      <Button
        disabled={loading || code.length !== CODE_LENGTH}
        className="w-full border-0 bg-gradient-to-r from-fuchsia-600 to-violet-600"
      >
        {loading ? 'Checking code…' : submitLabel}
      </Button>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={linkButton}>
          {backLabel}
        </button>
        <button type="button" onClick={onResend} disabled={loading || cooldown > 0} className={linkButton}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}
