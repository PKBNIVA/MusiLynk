import { vi } from 'vitest';

/** A fetch Response with a JSON body (or no body for 204). */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  if (status === 204) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Replaces window.location with a plain object so redirects can be observed. */
export function fakeLocation(pathname: string, search = '') {
  const original = Object.getOwnPropertyDescriptor(window, 'location')!;
  const location = { pathname, search, replace: vi.fn(), href: `http://localhost${pathname}${search}` };
  Object.defineProperty(window, 'location', { configurable: true, get: () => location });
  return { location, restore: () => Object.defineProperty(window, 'location', original) };
}

/** Makes a browser storage throw on every access, like a browser that blocks site data. */
export function blockStorage(name: 'localStorage' | 'sessionStorage') {
  const original = Object.getOwnPropertyDescriptor(window, name)!;
  const blocked = {
    getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  };
  Object.defineProperty(window, name, { configurable: true, get: () => blocked });
  return () => Object.defineProperty(window, name, original);
}

type XhrListener = (() => void) | null;

/** Minimal XMLHttpRequest stand-in: tests decide how each request finishes. */
export class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  timeout = 0;
  status = 0;
  responseText = '';
  body: unknown;
  requestHeaders: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: XhrListener = null;
  onerror: XhrListener = null;
  ontimeout: XhrListener = null;
  onabort: XhrListener = null;
  sent = false;
  aborted = false;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }

  send(body: unknown) {
    this.sent = true;
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  respond(status: number, data?: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.responseHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (data !== undefined) {
      this.responseHeaders['content-type'] ??= 'application/json';
      this.responseText = typeof data === 'string' ? data : JSON.stringify(data);
    }
    this.onload?.();
  }

  static latest() {
    return FakeXhr.instances[FakeXhr.instances.length - 1];
  }
}

/** Resolves once pending microtasks (and a macrotask turn) have run. */
export const flush = () => new Promise(resolve => setTimeout(resolve, 0));
