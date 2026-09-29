import { reportApiFailure } from './monitoring';
import { PROTECTED_AREA, signInPath } from './appTarget';

// `?.`: the Node smoke tests import this module without Vite, where import.meta.env is undefined.
export const API_BASE = import.meta.env?.VITE_API_URL || '/api';

const DEFAULT_TIMEOUT_MS = 12_000;
const MIN_RETRY_ATTEMPT_MS = 250;
const RETRYABLE_GET_STATUSES = new Set([429, 502, 503, 504]);
let authRedirectStarted = false;
const TOKEN_KEY = 'verse_access_token';
const RETURN_TO_KEY = 'verse_return_to';
const ACT_AS_KEY = 'verse_act_as';
/** The header the API reads the "acting as" identity from (see ActingAs on the backend). */
export const ACT_AS_HEADER = 'X-Verse-Act-As';
/** Fired on window (detail: the new key or null) when the acting-as identity changes. */
export const ACTING_AS_EVENT = 'verse:acting-as';
type StoreKind = 'local' | 'session';
// The access token lives in localStorage so new tabs, email links and browser
// restarts keep the session; the return-to path stays per tab in sessionStorage.
// Browsers that block site data throw on storage access; keep the session
// usable for this page load instead of failing every request.
const memoryStore = new Map<string, string>();
// A store whose writes failed (blocked or full) is read from memory from then on,
// so a token saved only in memory is not hidden by a readable-but-stale store.
const unwritableStores = new Set<StoreKind>();

function storageFor(kind: StoreKind): Storage {
  return kind === 'local' ? localStorage : sessionStorage;
}

function readStored(kind: StoreKind, key: string) {
  const memoryKey = `${kind}:${key}`;
  if (unwritableStores.has(kind)) return memoryStore.get(memoryKey) ?? null;
  try {
    return storageFor(kind).getItem(key);
  } catch {
    return memoryStore.get(memoryKey) ?? null;
  }
}

function writeStored(kind: StoreKind, key: string, value: string | null) {
  const memoryKey = `${kind}:${key}`;
  if (value === null) memoryStore.delete(memoryKey);
  else memoryStore.set(memoryKey, value);
  try {
    if (value === null) storageFor(kind).removeItem(key);
    else storageFor(kind).setItem(key, value);
  } catch {
    // The in-memory copy above is the fallback.
    unwritableStores.add(kind);
  }
}

let legacyTokenChecked = false;

function readToken() {
  const token = readStored('local', TOKEN_KEY);
  if (token || legacyTokenChecked) return token;
  // Sessions created before the token moved to localStorage live in this tab's
  // sessionStorage; move such a token across once so the user stays signed in.
  legacyTokenChecked = true;
  const legacy = readStored('session', TOKEN_KEY);
  if (!legacy) return null;
  writeStored('local', TOKEN_KEY, legacy);
  writeStored('session', TOKEN_KEY, null);
  return legacy;
}

function writeToken(token: string | null) {
  legacyTokenChecked = true;
  writeStored('local', TOKEN_KEY, token);
  // Never leave a legacy copy behind that could resurrect a signed-out session.
  writeStored('session', TOKEN_KEY, null);
}

class RequestDeadlineError extends Error {
  constructor() {
    super('Request deadline exceeded');
    this.name = 'AbortError';
  }
}

export type ApiOptions = RequestInit & {
  timeoutMs?: number;
  skipAuthRedirect?: boolean;
  /** Suppresses the app-wide PLAN_LIMIT_EVENT for this call, for a caller that shows its own
   * dedicated plan-limit dialog for the 402 (see PostJob's publish flow, V-14) instead of the
   * generic upgrade prompt. */
  skipPlanLimitEvent?: boolean;
};

// Server-enforced plan limits (402). Pages still show their own error; the app-level
// PlanLimitPrompt listens for this event and offers the upgrade path.
export const PLAN_LIMIT_EVENT = 'verse:plan-limit';
const PLAN_LIMIT_CODES = new Set(['PLAN_LIMIT_REACHED', 'PLAN_LIMIT']);
function announcePlanLimit(message?: string) {
  try {
    window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: { message } }));
  } catch {
    /* non-browser */
  }
}

/** The JSON body the API sends with an error status (see ApplicationController#render_error). */
export interface ApiErrorBody {
  error?: string;
  code?: string;
  requestId?: string;
  request_id?: string;
  /** Per-field messages for validation errors, keyed by the camelCase request field name. */
  fields?: unknown;
}

/** Validation messages per request field (camelCase), as `render_error(..., fields:)` sends them. */
export type ApiFieldErrors = Record<string, string[]>;

/** Keeps only well-formed `{name: [message, …]}` entries; anything else in the body is ignored. */
export function parseFieldErrors(raw: unknown): ApiFieldErrors | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const fields: ApiFieldErrors = {};
  for (const [name, value] of Object.entries(raw)) {
    const list = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    );
    if (list.length) fields[name] = list;
  }
  return Object.keys(fields).length ? fields : undefined;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  fields?: ApiFieldErrors;

  constructor(message: string, status: number, code?: string, requestId?: string, fields?: ApiFieldErrors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
  }
}

function requestIdFor(response: Response, data?: ApiErrorBody) {
  return response.headers.get('x-request-id') || data?.requestId || data?.request_id;
}

function redirectAfterUnauthorized(path: string, rejectedToken: string | null, skipRedirect = false) {
  const currentToken = readToken();
  // Another tab may have signed in again while this request was in flight; only the
  // session the server rejected may be cleared, never a newer one.
  if (currentToken !== rejectedToken) return;
  const hadSession = Boolean(currentToken);
  setAccessToken(null);
  if (!hadSession || skipRedirect || path.startsWith('/auth/') || authRedirectStarted) return;

  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (!PROTECTED_AREA.test(window.location.pathname)) return;

  authRedirectStarted = true;
  writeStored('session', RETURN_TO_KEY, currentPath);
  const role = window.location.pathname.split('/')[1] || 'jobseeker';
  window.location.replace(signInPath(role));
}

function retryDelay(response?: Response) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1_000, 0), 2_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 2_000);
  }
  return 200 + Math.floor(Math.random() * 201);
}

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithTimeout(url: string, options: ApiOptions) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  const timer = window.setTimeout(() => controller.abort(new RequestDeadlineError()), timeoutMs);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const actingAs = token ? getActingAs() : null;
  if (actingAs && !headers.has(ACT_AS_HEADER)) headers.set(ACT_AS_HEADER, actingAs);

  const method = (options.method || 'GET').toUpperCase();
  const canRetry = method === 'GET';
  const { timeoutMs, skipAuthRedirect, skipPlanLimitEvent, signal, ...requestOptions } = options;
  const deadlineAt = Date.now() + (timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= (canRetry ? 1 : 0); attempt += 1) {
    try {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      if (remainingMs === 0) throw new RequestDeadlineError();
      const response = await fetchWithTimeout(`${API_BASE}${path}`, {
        ...requestOptions,
        method,
        headers,
        credentials: 'omit',
        timeoutMs: remainingMs,
        signal,
      });
      lastResponse = response;

      if (canRetry && attempt === 0 && RETRYABLE_GET_STATUSES.has(response.status)) {
        const delayMs = retryDelay(response);
        if (deadlineAt - Date.now() >= delayMs + MIN_RETRY_ATTEMPT_MS) {
          await wait(delayMs, signal);
          continue;
        }
      }

      if (response.status === 204) return undefined as T;
      // A success that is not JSON means the request never reached the API (for example the
      // SPA's index.html served for /api/* when VITE_API_URL is missing). Treat it as an error
      // instead of rendering empty data as if everything worked.
      const isJson = /json/i.test(response.headers.get('content-type') || '');
      const parsed: unknown = isJson ? await response.json().catch(() => undefined) : undefined;
      if (response.ok && parsed === undefined) {
        reportApiFailure({
          status: response.status,
          code: 'INVALID_RESPONSE',
          method,
          path,
          requestId: requestIdFor(response),
        });
        throw new ApiError(
          'Verse received an unexpected response. Please try again shortly.',
          response.status,
          'INVALID_RESPONSE',
          requestIdFor(response),
        );
      }
      // The caller's T describes a success body; an error status carries ApiErrorBody instead.
      const data = (parsed ?? {}) as T & ApiErrorBody;
      const requestId = requestIdFor(response, data);
      if (response.status === 401) redirectAfterUnauthorized(path, token, skipAuthRedirect);
      if (!response.ok) {
        if (response.status === 402 && PLAN_LIMIT_CODES.has(data.code ?? '') && !skipPlanLimitEvent)
          announcePlanLimit(data.error);
        // A Page the person can no longer act as (removed as admin, Page hidden): fall back to themselves.
        if (response.status === 403 && data.code === 'ACT_AS_FORBIDDEN' && actingAs) setActingAs(null);
        if (response.status >= 500)
          reportApiFailure({ status: response.status, code: data.code, method, path, requestId });
        throw new ApiError(
          data.error || `Request failed (${response.status})`,
          response.status,
          data.code,
          requestId,
          parseFieldErrors(data.fields),
        );
      }
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw error;
      if (error instanceof RequestDeadlineError) {
        reportApiFailure({ status: 0, code: 'REQUEST_TIMEOUT', method, path });
        throw new ApiError('Request timed out. Please try again.', 0, 'REQUEST_TIMEOUT');
      }
      if (canRetry && attempt === 0) {
        const delayMs = retryDelay(lastResponse);
        if (deadlineAt - Date.now() >= delayMs + MIN_RETRY_ATTEMPT_MS) {
          await wait(delayMs, signal);
          continue;
        }
      }
      const timedOut = error instanceof DOMException && error.name === 'AbortError';
      reportApiFailure({ status: 0, code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', method, path });
      throw new ApiError(
        timedOut
          ? 'Request timed out. Please try again.'
          : 'Network request failed. Check your connection and try again.',
        0,
        timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      );
    }
  }

  throw new ApiError('Network request failed. Check your connection and try again.', 0, 'NETWORK_ERROR');
}

export function setAccessToken(token?: string | null) {
  // Every sign-in starts as the person themselves, and signing out forgets the choice.
  setActingAs(null);
  if (token) {
    writeToken(token);
    authRedirectStarted = false;
  } else {
    writeToken(null);
  }
}

/** The identity key ("organization:<id>", "act:<id>") requests act as, or null for yourself. */
export function getActingAs() {
  return readStored('local', ACT_AS_KEY);
}

/** Persists the acting-as choice (null or a "user:" key means yourself) and announces it. */
export function setActingAs(key: string | null) {
  const next = key && !key.startsWith('user:') ? key : null;
  if (next === getActingAs()) return;
  writeStored('local', ACT_AS_KEY, next);
  try {
    window.dispatchEvent(new CustomEvent(ACTING_AS_EVENT, { detail: next }));
  } catch {
    /* non-browser */
  }
}

export function hasAccessToken() {
  return Boolean(readToken());
}

/**
 * Calls `listener` when another tab signs in or out. Storage events fire only in
 * the other tabs of this origin, so this tab's own writes never loop back.
 */
export function onAccessTokenChange(listener: (signedIn: boolean) => void) {
  const handler = (event: StorageEvent) => {
    // A null key means the other tab cleared all of localStorage.
    if (event.key !== null && event.key !== TOKEN_KEY) return;
    try {
      if (event.storageArea !== localStorage) return;
    } catch {
      return;
    }
    const token = event.key === null ? null : event.newValue;
    if (token) {
      memoryStore.set(`local:${TOKEN_KEY}`, token);
      authRedirectStarted = false;
    } else {
      memoryStore.delete(`local:${TOKEN_KEY}`);
    }
    listener(Boolean(token));
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/** Returns and clears the protected page saved before a forced sign-in. */
export function consumeReturnTo() {
  const path = readStored('session', RETURN_TO_KEY);
  writeStored('session', RETURN_TO_KEY, null);
  return path;
}

export const apiGet = <T = unknown>(path: string, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'GET' });
export const apiPost = <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'POST', body: JSON.stringify(body ?? {}) });
export const apiPut = <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body ?? {}) });
export const apiPatch = <T = unknown>(path: string, body?: unknown, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const apiDelete = <T = unknown>(path: string, options: ApiOptions = {}) =>
  api<T>(path, { ...options, method: 'DELETE' });

/** Email sign-in codes. The response is identical whether or not an account exists. */
export interface SignInCodeRequest {
  email: string;
  name?: string;
  role?: 'jobseeker' | 'employer';
  /** Sign-up only: the Terms and Privacy Policy box, carried to the account the code creates. */
  consent?: boolean;
}
export interface SignInCodeResponse {
  ok: boolean;
  message: string;
  expiresIn: number;
  /** Local QA only: returned outside production when no email provider is configured. */
  debugCode?: string;
}
export const requestSignInCode = (payload: SignInCodeRequest) =>
  apiPost<SignInCodeResponse>('/auth/otp/request', payload);
export interface AuthConnectionSummary {
  id: string;
  provider: 'google' | 'youtube' | 'spotify' | 'instagram';
  email?: string | null;
  displayName?: string | null;
  connectedAt: string;
}
export interface SignInMethods {
  signInCodes?: boolean;
  password?: boolean;
  emailDelivery?: boolean;
  /** Which third-party/alternate sign-in paths are configured right now. */
  providers?: { google?: boolean; whatsapp?: boolean };
  /** Only present when signed in: the caller's own connected accounts. */
  connections?: AuthConnectionSummary[];
}
export const getSignInMethods = () => apiGet<SignInMethods>('/auth/methods');
/** A single-use, 5-minute ticket identifying the signed-in user for intent=connect. */
export const requestGoogleConnectTicket = () => apiPost<{ ticket: string; expiresIn: number }>('/auth/connect-ticket');
export const disconnectAuthConnection = (id: string) => apiDelete(`/auth/connections/${id}`);

/**
 * The API's origin (without the trailing /api), for the two Google sign-in endpoints
 * (GoogleAuthController) that live outside the JSON API and are navigated to directly by
 * the browser, not fetched.
 */
export const apiOrigin = () => API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

export interface GoogleStartOptions {
  intent: 'signin' | 'connect';
  role?: 'jobseeker' | 'employer';
  returnTo?: string;
  consent?: boolean;
  /** intent=connect only: a one-time ticket from requestGoogleConnectTicket (never the bearer token). */
  ticket?: string;
}
/** Builds the URL for "Continue with Google"; the caller navigates the browser to it directly
 * (window.location.href = …), it is never fetched. See GoogleAuthController#start. */
export function googleStartUrl({ intent, role, returnTo, consent, ticket }: GoogleStartOptions): string {
  const params = new URLSearchParams({ intent });
  if (role) params.set('role', role);
  if (returnTo) params.set('return_to', returnTo);
  if (consent) params.set('consent', '1');
  if (intent === 'connect' && ticket) params.set('ticket', ticket);
  return `${apiOrigin()}/auth/google/start?${params.toString()}`;
}

/** Friendly copy for `?auth_error=` on return from Google (see GoogleAuthController). */
export const GOOGLE_AUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'That sign-in link expired. Try again.',
  email_unverified: "Google hasn't verified that email. Sign in with your email instead.",
  connected_elsewhere:
    'That Google account is already connected to another Verse account. Sign in with Google to use it, or contact us to merge.',
  provider_error: "Google didn't complete the sign-in. Try again.",
};

// ---- Uploads -------------------------------------------------------------
// Mirrors backend MediaTypeSniffer / Upload::MAX_SIZE. The server re-checks the real
// bytes; these checks only give the user an immediate, specific error.
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const UPLOAD_ACCEPT =
  'audio/mpeg,audio/wav,video/mp4,image/jpeg,image/png,image/webp,application/pdf,.mp3,.wav,.mp4,.jpg,.jpeg,.png,.webp,.pdf';
const UPLOAD_TYPE_ALIASES: Record<string, string> = {
  'audio/mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
};
const UPLOAD_TYPES_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};
const UPLOAD_TYPES = new Set(Object.values(UPLOAD_TYPES_BY_EXTENSION));

export type UploadResult = {
  id?: string;
  url: string;
  contentType?: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
  thumbnailUrl?: string;
  waveformUrl?: string;
};
export type UploadOptions = { onProgress?: (pct: number) => void; signal?: AbortSignal };

/** Canonical upload MIME type for a file, or null when the platform does not accept it. */
export function uploadContentType(file: File): string | null {
  const declared = (file.type || '').toLowerCase();
  const canonical = UPLOAD_TYPE_ALIASES[declared] || declared;
  if (UPLOAD_TYPES.has(canonical)) return canonical;
  // Some browsers/OSes report an empty or vendor type; fall back to the extension.
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return !declared || declared === 'application/octet-stream' ? UPLOAD_TYPES_BY_EXTENSION[extension] || null : null;
}

/** Throws a user-facing ApiError when the file cannot be uploaded at all. */
export function validateUploadFile(file: File) {
  if (!uploadContentType(file))
    throw new ApiError('Unsupported file type. Upload MP3, WAV, MP4, JPEG, PNG, WebP or PDF.', 422, 'UNSUPPORTED_TYPE');
  if (file.size === 0) throw new ApiError('This file is empty.', 422, 'FILE_EMPTY');
  if (file.size > UPLOAD_MAX_BYTES)
    throw new ApiError(
      `File is too large (${Math.ceil(file.size / 1024 / 1024)} MB). The limit is 100 MB.`,
      422,
      'FILE_TOO_LARGE',
    );
}

/** A stored file as the API describes it (Upload#api_json). */
export interface UploadRecord {
  id: string;
  url: string;
  status: string;
  contentType: string;
  byteSize: number;
  filename: string;
}

/** POST /uploads/presign: either signed bucket instructions or the API's own streaming endpoint. */
type PresignResponse =
  | {
      mode: 'direct';
      id: string;
      method?: 'PUT' | 'POST';
      uploadUrl: string;
      headers?: Record<string, string>;
      fields?: Record<string, string>;
      publicUrl?: string;
      completeUrl?: string;
      expiresIn?: number;
    }
  | { mode: 'proxied'; uploadUrl: string };

/** POST /uploads/:id/complete */
type CompleteResponse = { upload?: UploadRecord; url: string };

/** PUT /uploads/local: the success fields are present on a 2xx, the error fields otherwise. */
type ProxiedUploadBody = ApiErrorBody & { id: string; url: string; upload?: UploadRecord };

type XhrResult = { status: number; data: ProxiedUploadBody; requestId?: string };

// fetch() has no upload progress events, so file bodies go through XMLHttpRequest.
function sendWithProgress(
  method: string,
  url: string,
  body: Document | XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  options: UploadOptions,
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = 30 * 60_000;
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => options.signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      let data = {} as ProxiedUploadBody;
      try {
        if (xhr.responseText && xhr.getResponseHeader('content-type')?.includes('json'))
          data = JSON.parse(xhr.responseText) as ProxiedUploadBody;
      } catch {
        data = {} as ProxiedUploadBody;
      }
      resolve({ status: xhr.status, data, requestId: xhr.getResponseHeader('x-request-id') || data?.requestId });
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError('Upload interrupted. Check your connection and retry.', 0, 'NETWORK_ERROR'));
    };
    xhr.ontimeout = () => {
      done();
      reject(new ApiError('Upload timed out. Please retry.', 0, 'REQUEST_TIMEOUT'));
    };
    xhr.onabort = () => {
      done();
      reject(new ApiError('Upload cancelled.', 0, 'UPLOAD_CANCELLED'));
    };
    if (options.signal?.aborted) return xhr.abort();
    xhr.send(body);
  });
}

/**
 * Uploads a work-sample file and resolves once the server has verified it.
 * Direct mode: presign -> browser POST/PUT to the bucket -> /uploads/:id/complete.
 * Proxied mode: streamed PUT to the API, which verifies before storing.
 */
export async function uploadMedia(
  file: File,
  onProgressOrOptions?: ((pct: number) => void) | UploadOptions,
): Promise<UploadResult> {
  const options: UploadOptions =
    typeof onProgressOrOptions === 'function' ? { onProgress: onProgressOrOptions } : onProgressOrOptions || {};
  validateUploadFile(file);
  const contentType = uploadContentType(file)!;
  options.onProgress?.(0);
  const prep = await apiPost<PresignResponse>(
    '/uploads/presign',
    { filename: file.name, contentType, size: file.size },
    { signal: options.signal },
  );

  if (prep.mode === 'direct') {
    let body: XMLHttpRequestBodyInit = file;
    if ((prep.method || 'PUT').toUpperCase() === 'POST') {
      const form = new FormData();
      Object.entries(prep.fields || {}).forEach(([name, value]) => form.append(name, String(value)));
      form.append('file', file); // S3 requires the file to be the last field.
      body = form;
    }
    const sent = await sendWithProgress(
      prep.method || 'PUT',
      prep.uploadUrl,
      body,
      prep.method === 'POST' ? {} : prep.headers || { 'Content-Type': contentType },
      options,
    );
    if (sent.status < 200 || sent.status >= 300) {
      await apiDelete(`/uploads/${prep.id}`, { skipAuthRedirect: true }).catch(() => undefined);
      throw new ApiError(
        sent.status === 403
          ? 'Storage refused the file (size or type did not match, or the link expired). Please retry.'
          : `Upload failed (${sent.status}). Please retry.`,
        sent.status,
        'UPLOAD_FAILED',
      );
    }
    const done = await apiPost<CompleteResponse>(`/uploads/${prep.id}/complete`, {}, { signal: options.signal });
    options.onProgress?.(100);
    return {
      id: done.upload?.id || prep.id,
      url: done.url,
      contentType: done.upload?.contentType,
      byteSize: done.upload?.byteSize,
    };
  }

  const token = readToken();
  const safeFilename = file.name.replace(/[^A-Za-z0-9_.-]/g, '_') || 'upload';
  const headers: Record<string, string> = { 'Content-Type': contentType, 'X-Filename': safeFilename };
  if (token) headers.Authorization = `Bearer ${token}`;
  const uploadUrl = prep.uploadUrl.startsWith('http')
    ? prep.uploadUrl
    : `${API_BASE.replace(/\/api\/?$/, '')}${prep.uploadUrl}`;
  const sent = await sendWithProgress('PUT', uploadUrl, file, headers, options);
  if (sent.status === 401) redirectAfterUnauthorized('/uploads/local', token);
  if (sent.status < 200 || sent.status >= 300)
    throw new ApiError(
      sent.data.error || `Upload failed (${sent.status})`,
      sent.status,
      sent.data.code,
      sent.requestId,
    );
  options.onProgress?.(100);
  return {
    ...sent.data,
    id: sent.data.id,
    url: sent.data.url,
    contentType: sent.data.upload?.contentType,
    byteSize: sent.data.upload?.byteSize,
  };
}

/** Discards an uploaded file that was never saved to a work sample. */
export const discardUpload = (id: string) => apiDelete(`/uploads/${id}`, { skipAuthRedirect: true });
