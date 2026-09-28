import { useCallback, useMemo, useRef, useState } from 'react';
import { ApiError, type ApiFieldErrors } from './api';
import { errorMessage } from './errors';

// Shared form error handling: one message per field, shown inline next to its input (see
// components/form/Field.tsx), with focus moved to the first invalid field. Toasts are for
// success and for failures that belong to no field (network, server).

/** One message per field name. */
export type FieldErrorMap<K extends string = string> = Partial<Record<K, string>>;

export interface FormErrorsOptions<K extends string> {
  /**
   * Maps a field name (as used in `errors` and as the API names it in `fields`) to the id of its
   * control, when they differ. Defaults to the field name itself.
   */
  ids?: Partial<Record<K, string>>;
  /** Maps API field names (camelCase request params) to this form's field names, when they differ. */
  apiFields?: Record<string, K>;
}

/** The first message per field from an API error's `fields`, renamed through `apiFields`. */
export function fieldErrorsFromApi<K extends string = string>(
  fields: ApiFieldErrors | undefined,
  apiFields: Record<string, K> = {},
): FieldErrorMap<K> {
  const out: FieldErrorMap<K> = {};
  if (!fields) return out;
  for (const [name, messages] of Object.entries(fields)) {
    const key = (apiFields[name] ?? name) as K;
    if (out[key] === undefined && messages[0]) out[key] = messages[0];
  }
  return out;
}

/** True when the map holds at least one message. */
export function hasErrors(errors: FieldErrorMap): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Focuses (and scrolls to) the first control, in document order, whose field has an error.
 * Returns the element it focused, if any.
 */
export function focusFirstInvalid(
  errors: FieldErrorMap,
  idFor: (name: string) => string = (name) => name,
  root: ParentNode = document,
): HTMLElement | null {
  const elements = Object.keys(errors)
    .filter((name) => errors[name])
    .map((name) => {
      const id = idFor(name);
      return (root.querySelector(`[id="${CSS.escape(id)}"]`) as HTMLElement | null) ?? null;
    })
    .filter((element): element is HTMLElement => element !== null);
  if (!elements.length) return null;
  elements.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const first = elements[0];
  first.focus({ preventScroll: true });
  first.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  return first;
}

/**
 * Form error state: `errors` per field plus `formError` for messages that belong to no field.
 *
 * - `setErrors(map)` replaces the field errors (use after client-side validation) and returns
 *   whether any are set.
 * - `setFromApi(error)` reads an ApiError's `fields` into `errors`; a message it cannot place goes
 *   to `formError`. Returns true when it placed at least one field error.
 * - `focusFirst()` focuses the first invalid control in document order.
 * - `clear(name)` removes one field's error (call it from the field's onChange).
 */
export function useFormErrors<K extends string = string>(options: FormErrorsOptions<K> = {}) {
  const [errors, setErrorState] = useState<FieldErrorMap<K>>({});
  const [formError, setFormError] = useState('');
  // Latest errors for focusFirst(), which often runs in the same tick as setErrors().
  const latest = useRef<FieldErrorMap<K>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const idFor = useCallback((name: string) => optionsRef.current.ids?.[name as K] ?? name, []);

  const setErrors = useCallback((next: FieldErrorMap<K>) => {
    latest.current = next;
    setErrorState(next);
    return hasErrors(next);
  }, []);

  const setFieldError = useCallback((name: K, message: string) => {
    const next = { ...latest.current };
    if (message) next[name] = message;
    else delete next[name];
    latest.current = next;
    setErrorState(next);
  }, []);

  const clear = useCallback((name?: K) => {
    if (name === undefined) {
      latest.current = {};
      setErrorState({});
      setFormError('');
      return;
    }
    if (latest.current[name] === undefined) return;
    const next = { ...latest.current };
    delete next[name];
    latest.current = next;
    setErrorState(next);
  }, []);

  const focusFirst = useCallback(() => focusFirstInvalid(latest.current, idFor), [idFor]);

  const setFromApi = useCallback((error: unknown, fallback = 'Something went wrong. Please try again.') => {
    const fields = error instanceof ApiError ? error.fields : undefined;
    const mapped = fieldErrorsFromApi<K>(fields, optionsRef.current.apiFields);
    const placed = hasErrors(mapped);
    latest.current = mapped;
    setErrorState(mapped);
    // A server message that names no field of this form still has to be shown somewhere.
    setFormError(placed ? '' : errorMessage(error, fallback));
    return placed;
  }, []);

  /** Props for a Field: its error message (if any). */
  const errorFor = useCallback((name: K) => errors[name], [errors]);

  return useMemo(
    () => ({
      errors,
      formError,
      setErrors,
      setFieldError,
      setFormError,
      setFromApi,
      clear,
      focusFirst,
      errorFor,
    }),
    [errors, formError, setErrors, setFieldError, setFromApi, clear, focusFirst, errorFor],
  );
}

/**
 * Ref-based double-submit guard. `run(fn)` starts `fn` only when no earlier run is still in
 * flight; the check is synchronous, so three clicks in the same task send one request (React
 * state alone only disables the button after a re-render). `busy` drives the button's disabled
 * and label state.
 */
export function useSubmitOnce() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

// Shared value checks, matching the server's rules, so the same message appears before submit.

/** An absolute http(s) URL with a host, like the API's SafeHttpUrlValidator accepts. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username;
  } catch {
    return false;
  }
}

/** A phone number: digits with optional +, spaces, dots, dashes and brackets; 7–15 digits. */
export function isPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15;
}

export const URL_MESSAGE = 'Enter a full web address starting with https://';
export const PHONE_MESSAGE = 'Enter a phone number with 7 to 15 digits, for example +91 98765 43210.';
