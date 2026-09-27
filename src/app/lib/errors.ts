// Helpers for `catch (e: unknown)` blocks: read what a thrown value says without assuming its shape.

/** The thrown value's `message` when it has a non-empty one, otherwise `fallback`. */
export function errorMessage(error: unknown, fallback = ''): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
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
