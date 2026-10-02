import { RELEASE } from './monitoring';

// "Report a problem": what the dialog collects, how it is described to the person before it is
// sent, and the request itself. The dialog (ProblemReportDialog) is loaded on demand; this module
// is small and shared by it, the host that opens it and the tests.

export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024;
export const DESCRIPTION_MAX = 4000;
export const EXPECTED_MAX = 2000;

const SENSITIVE_PARAM =
  /^(t|k|s|sig|code|state|auth|ticket|otp|jwt)$|token|secret|signature|password|passwd|email|key|session|credential|reset|invite|vouch|unsubscribe/i;
const CREDENTIAL_SEGMENT = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{24,}$/;
const RECORD_ID = /^([a-z]{2,6}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The page to report: path plus harmless query parameters. Token-like parameters (t=, token=, code=,
 * …), credential-looking path segments and the fragment never leave the browser. The server cleans
 * it again; this is what the person sees before sending.
 */
export function sanitizePageUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href, 'https://verse.invalid');
  } catch {
    return '/';
  }
  const path = url.pathname
    .split('/')
    .map((segment) => (CREDENTIAL_SEGMENT.test(segment) && !RECORD_ID.test(segment) ? ':token' : segment))
    .join('/');
  const kept = [...url.searchParams.entries()].filter(([name]) => !SENSITIVE_PARAM.test(name)).slice(0, 8);
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${path}${query}`.slice(0, 300);
}

/** "Chrome 130" / "Safari 17" from the user agent. Coarse on purpose. */
export function describeBrowser(ua: string): string {
  // Edge, Opera and Samsung Internet also say "Chrome/…" earlier in the string, so look for the
  // specific names first instead of taking the leftmost token.
  const match =
    /(Edg|OPR|SamsungBrowser|CriOS|FxiOS)\/(\d+)/.exec(ua) ??
    /(Firefox|Chrome|Version)\/(\d+)/.exec(ua) ??
    /(Safari)\/(\d+)/.exec(ua);
  if (!match) return 'Unknown browser';
  const names: Record<string, string> = {
    Edg: 'Edge',
    OPR: 'Opera',
    SamsungBrowser: 'Samsung Internet',
    CriOS: 'Chrome',
    FxiOS: 'Firefox',
    Version: 'Safari',
  };
  return `${names[match[1]] ?? match[1]} ${match[2]}`;
}

/** "Android 14" / "iOS 17" / "Windows" / "macOS" / "Linux". */
export function describeOs(ua: string): string {
  const android = /Android (\d+)/.exec(ua);
  if (android) return `Android ${android[1]}`;
  const ios = /(?:iPhone|iPad|CPU) OS (\d+)/.exec(ua);
  if (ios) return `iOS ${ios[1]}`;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown device';
}

export type ReportContext = {
  page: string;
  release: string;
  browser: string;
  os: string;
  viewport: { width: number; height: number };
  errors: string[];
};

/** Everything attached with the person's consent. Never storage, cookies, tokens or form contents. */
export function collectContext(errors: string[]): ReportContext {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return {
    page: sanitizePageUrl(`${window.location.pathname}${window.location.search}`),
    release: RELEASE || (window as Window & { __VERSE_RELEASE__?: string }).__VERSE_RELEASE__ || 'unknown',
    browser: describeBrowser(ua),
    os: describeOs(ua),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    errors,
  };
}

export type ScreenshotCheck = { ok: true } | { ok: false; message: string };

export function checkScreenshot(file: Pick<File, 'type' | 'size'>): ScreenshotCheck {
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type))
    return { ok: false, message: 'Choose a PNG, JPEG or WebP image.' };
  if (file.size === 0) return { ok: false, message: 'That file is empty. Choose another image.' };
  if (file.size > SCREENSHOT_MAX_BYTES)
    return { ok: false, message: `That image is too large. Keep it under ${SCREENSHOT_MAX_BYTES / 1024 / 1024} MB.` };
  return { ok: true };
}

/** True when this browser can capture the current tab (desktop browsers; phones cannot). */
export function canCaptureScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

const CAPTURE_MAX_WIDTH = 1600;

/**
 * Captures what the person is looking at using the browser's own screen-sharing permission step
 * (nothing is recorded or sent until they press Send). Resolves to a JPEG, or null when they cancel.
 */
export async function captureScreen(): Promise<File | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' },
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      audio: false,
    } as DisplayMediaStreamOptions);
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return null;
    throw error;
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // Give the first real frame time to arrive (a blank frame is possible straight after play()).
    await new Promise((resolve) => setTimeout(resolve, 250));
    const scale = Math.min(1, CAPTURE_MAX_WIDTH / (video.videoWidth || CAPTURE_MAX_WIDTH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'page.jpg', { type: 'image/jpeg' }) : null;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/** Shrinks a large photo or screenshot to a JPEG under the limit. Resolves to the original if it already fits or cannot be shrunk. */
export async function fitScreenshot(file: File): Promise<File> {
  if (file.size <= SCREENSHOT_MAX_BYTES || !(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? new File([blob], 'screenshot.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export type ProblemReportInput = {
  description: string;
  expected: string;
  email?: string;
  screenshot?: File | null;
  /** The context the person agreed to attach, or null when they switched it off. */
  context: ReportContext | null;
  /** Hidden "website" field; real people leave it empty. */
  honeypot?: string;
};

/** The multipart body POST /api/problem-reports expects. */
export function buildProblemReportForm(input: ProblemReportInput): FormData {
  const form = new FormData();
  form.set('description', input.description.trim().slice(0, DESCRIPTION_MAX));
  if (input.expected.trim()) form.set('expected', input.expected.trim().slice(0, EXPECTED_MAX));
  if (input.email) form.set('email', input.email.trim());
  if (input.screenshot) form.set('screenshot', input.screenshot, input.screenshot.name);
  if (input.honeypot) form.set('website', input.honeypot);
  form.set('includeContext', input.context ? 'true' : 'false');
  if (input.context) {
    const { page, ...rest } = input.context;
    form.set('page', page);
    form.set('context', JSON.stringify(rest));
  }
  return form;
}
