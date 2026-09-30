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

const PENDING_KEY = (userId: string) => `verse:verification-pending:${userId}`;
const PENDING_DAYS = 30;

/** When this person's professional verification request was sent from this browser, if it still counts as pending. */
export function pendingVerificationSince(userId: string, now = Date.now()): string | null {
  try {
    const since = localStorage.getItem(PENDING_KEY(userId));
    if (!since) return null;
    const age = now - new Date(since).getTime();
    return Number.isFinite(age) && age >= 0 && age < PENDING_DAYS * 86_400_000 ? since : null;
  } catch {
    return null;
  }
}

export function rememberPendingVerification(userId: string, now = new Date()) {
  try {
    localStorage.setItem(PENDING_KEY(userId), now.toISOString());
  } catch {
    /* best effort: the button simply comes back after a reload */
  }
}

export function forgetPendingVerification(userId: string) {
  try {
    localStorage.removeItem(PENDING_KEY(userId));
  } catch {
    /* nothing to undo */
  }
}
