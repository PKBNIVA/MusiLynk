// The last few client errors on this page, offered by "Report a problem". Messages only (no stacks,
// no payloads), scrubbed of emails and secrets and kept short. They live in memory and are gone when
// the tab closes. Screens with the account menu or the footer start watching for uncaught errors
// (watchClientErrors); the app error screens hand over the error that brought them up.

const MAX_ERRORS = 10;
const MAX_LENGTH = 200;
const recent: string[] = [];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SECRET_PAIR = /\b([\w-]*(?:token|code|secret|password|key|signature|auth)[\w-]*)=[^&\s"']+/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/=]+/gi;

/** A message safe to show and send: no email addresses, bearer tokens or secret-looking values. */
export function scrubMessage(raw: string): string {
  return raw
    .replace(BEARER, '$1 [removed]')
    .replace(SECRET_PAIR, '$1=[removed]')
    .replace(EMAIL, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH);
}

/** Remembers an error message in memory (the last 10). */
export function noteClientError(value: unknown) {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : '';
  const message = scrubMessage(text);
  if (message && recent.push(message) > MAX_ERRORS) recent.shift();
}

export function getRecentErrors(): string[] {
  return [...recent];
}

/** Starts noting uncaught errors and unhandled rejections; the returned function stops it. */
export function watchClientErrors() {
  const onError = (event: ErrorEvent) => noteClientError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => noteClientError(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
