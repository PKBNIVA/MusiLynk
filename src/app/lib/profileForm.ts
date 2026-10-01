// Small pieces of the profile page's behaviour that are worth testing on their own.

/**
 * "example.com" becomes "https://example.com" so a web address typed the way people say it passes
 * validation (J-18). Anything that already has a scheme is left alone (the validator decides), and
 * so is text that cannot be an address (spaces, or no dot in the host): it fails validation as before.
 */
export function normalizeWebAddress(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /\s/.test(value)) return value;
  const bare = value.replace(/^\/+/, '');
  const host = bare.split(/[/?#]/)[0];
  return host.includes('.') ? `https://${bare}` : value;
}
