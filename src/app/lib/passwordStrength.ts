// Client-side mirror of the server rule (backend/app/services/password_strength.rb):
// length >= 10, not one of the most common passwords, and not built from the
// account's own email local part or name. The server is the source of truth (this
// list is a lightweight subset so the bundle stays small); this only powers the
// live checklist shown on the register, reset-password and change-password forms.
export const PASSWORD_MIN_LENGTH = 10;

const COMMON_PASSWORDS = new Set([
  '123456',
  'password',
  '123456789',
  '12345678',
  '12345',
  'qwerty',
  '1234567',
  '111111',
  '1234567890',
  '123123',
  'abc123',
  'password1',
  'iloveyou',
  '1q2w3e4r',
  '000000',
  'qwerty123',
  'dragon',
  'monkey',
  'letmein',
  'trustno1',
  'baseball',
  'football',
  'superman',
  'batman',
  'soccer',
  'master',
  'jennifer',
  'welcome',
  'admin',
  'admin123',
  'root',
  'changeme',
  'secret',
  'guest',
  'default',
  'pass1234',
  'pass123',
  'solo',
  'phoenix',
  '121212',
  '654321',
  '7777777',
  'computer',
  'internet',
  'password123',
  'password1234',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1qaz2wsx',
  'starwars',
  'whatever',
  'mustang',
  'cowboy',
  'pokemon',
  'sunshine',
  'princess',
  'flower',
  'loveme',
  'shadow',
  'michael',
  'jordan',
  'jordan23',
]);

export interface PasswordChecklist {
  minLength: boolean;
  notCommon: boolean;
  notIdentity: boolean;
  valid: boolean;
}

function identityFragments(email: string, name: string): string[] {
  const localPart = (email.split('@')[0] || '').toLowerCase();
  const nameParts = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return [localPart, ...nameParts];
}

export function checkPasswordStrength(password: string, email = '', name = ''): PasswordChecklist {
  const value = password || '';
  const minLength = value.length >= PASSWORD_MIN_LENGTH;
  const notCommon = !COMMON_PASSWORDS.has(value.toLowerCase());
  const lower = value.toLowerCase();
  const notIdentity = !identityFragments(email, name).some(
    (fragment) => fragment.length >= 3 && lower.includes(fragment),
  );
  return { minLength, notCommon, notIdentity, valid: minLength && notCommon && notIdentity };
}
