import { Check, X } from 'lucide-react';
import { checkPasswordStrength, PASSWORD_MIN_LENGTH } from '../lib/passwordStrength';

/** Live checklist next to a new-password field (FORM-14): length, not a common password,
 * not built from your name/email. The server enforces the same rule and is authoritative. */
export function PasswordChecklist({
  password,
  email = '',
  name = '',
}: {
  password: string;
  email?: string;
  name?: string;
}) {
  const check = checkPasswordStrength(password, email, name);
  const items: Array<[boolean, string]> = [
    [check.minLength, `At least ${PASSWORD_MIN_LENGTH} characters`],
    [check.notCommon, 'Not a commonly used password'],
    [check.notIdentity, 'Does not contain your name or email'],
  ];
  return (
    <ul className="mt-2 space-y-1 text-xs" aria-live="polite">
      {items.map(([ok, label]) => (
        <li key={label} className={`flex items-center gap-1.5 ${ok ? 'text-emerald-300' : 'text-slate-400'}`}>
          {ok ? (
            <Check size={13} className="shrink-0" aria-hidden="true" />
          ) : (
            <X size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
          )}
          <span>
            {label}
            <span className="sr-only">{ok ? ' (met)' : ' (not met yet)'}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
