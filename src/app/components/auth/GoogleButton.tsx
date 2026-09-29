import { Button } from '../ui/button';
import { googleStartUrl } from '../../lib/api';
import { track } from '../../lib/analytics';

/**
 * "Continue with Google", shown above the email form on an "or" rule. Only rendered by the
 * caller when `/auth/methods`' `providers.google` is true. A full-page navigation (never a
 * fetch): the browser goes to GoogleAuthController#start and comes back with the session
 * already set, or with `?auth_error=`. See GoogleAuthController and googleStartUrl.
 */
export function GoogleButton({
  intent,
  role,
  returnTo,
  consent,
  disabled,
  showDivider = true,
}: {
  intent: 'signin' | 'connect';
  role?: 'jobseeker' | 'employer';
  returnTo?: string;
  /** Sign-up only: the Terms and Privacy Policy box must be ticked before this is usable. */
  consent?: boolean;
  disabled?: boolean;
  /** False on the account settings "Connect" row, which is not above an email form. */
  showDivider?: boolean;
}) {
  const go = () => {
    track('auth_google_start', { intent, role: role ?? null });
    window.location.href = googleStartUrl({ intent, role, returnTo, consent });
  };

  return (
    <div className={showDivider ? 'space-y-4' : undefined}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={go}
        className={
          showDivider ? 'w-full gap-2.5 border-white/15 bg-white/[.04] text-white hover:bg-white/[.09]' : 'gap-2.5'
        }
      >
        <GoogleGlyph />
        {intent === 'connect' ? 'Connect' : 'Continue with Google'}
      </Button>
      {showDivider && (
        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
          <span className="h-px flex-1 bg-white/10" />
          or
          <span className="h-px flex-1 bg-white/10" />
        </div>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3.01h3.86c2.26-2.08 3.59-5.17 3.59-8.66z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.86-3.01c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.11C3.26 21.3 7.29 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.14 7.14 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.28A11.97 11.97 0 0 0 0 12c0 1.93.46 3.76 1.28 5.39z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.94 1.19 15.24 0 12 0 7.29 0 3.26 2.7 1.28 6.61l3.99 3.11C6.22 6.87 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
