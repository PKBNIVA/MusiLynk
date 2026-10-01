// Helpers for `catch (e: unknown)` blocks: read what a thrown value says without assuming its shape.

const FAILURE = /could not|couldn.t|can.?t |cannot|unable|failed|not saved/i;
const HAS_NEXT_STEP = /try|retry|refresh|request a new|check|choose|go back|contact|sign in|upgrade|again/i;

/** A failure message that says what to do next: "Unable to send your message." → "… Try again." */
export function withNextStep(text: string): string {
  return FAILURE.test(text) && !HAS_NEXT_STEP.test(text) ? `${text.replace(/\.?\s*$/, '')}. Try again.` : text;
}

/** What a request that failed without a message from the server says. */
export function requestFailedMessage(status: number): string {
  return status >= 500
    ? 'Something went wrong on our side. Try again in a moment.'
    : 'That did not go through. Check what you entered and try again.';
}

/** The thrown value's `message` when it has a non-empty one, otherwise `fallback` (always with a next step). */
export function errorMessage(error: unknown, fallback = ''): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
  return withNextStep(fallback);
}

/** The HTTP status carried by an ApiError (or anything shaped like one), if any. */
export function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status?: unknown };
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** The machine-readable `code` carried by an ApiError, if any. */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') return code;
  }
  return undefined;
}
