import AxeBuilder from '@axe-core/playwright';
import { chromium, request, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadIds, roleKind, type RoleName } from './routes';

// Capture helpers for tests/e2e/zz-ux-sweep.spec.ts: signed-in sessions per role, settled screenshots
// (first fold + full page), per-shot diagnostics, and the index.json writer.

export const WEB = (process.env.UX_WEB_URL || 'http://127.0.0.1:4600').replace(/\/$/, '');
export const ADMIN = (process.env.UX_ADMIN_URL || 'http://127.0.0.1:4610').replace(/\/$/, '');
export const API = (process.env.UX_API_URL || 'http://127.0.0.1:3300/api').replace(/\/$/, '');
export const OUT = (process.env.UX_OUT || '/home/user/ux-shots').replace(/\/$/, '');
export const PASSWORD = process.env.UX_PASSWORD || 'UxSweepPass123!';
export const ADMIN_PASSWORD = process.env.UX_ADMIN_PASSWORD || 'UxSweepAdmin-2026-Local';
const AXE = process.env.UX_AXE !== '0';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  small: { width: 360, height: 740 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;
export const vpLabel = (name: ViewportName) => `${VIEWPORTS[name].width}x${VIEWPORTS[name].height}`;

export interface FailedRequest {
  url: string;
  status: number;
  method: string;
  error?: string;
  /** Non-local host (e.g. YouTube, ccMixter): unreachable from the sandbox, not an app defect. */
  external: boolean;
  /** Known, intended answer (a signed-out visitor's GET /me is 401). */
  expected: boolean;
}
export interface ConsoleError {
  text: string;
  url?: string;
  external: boolean;
  expected: boolean;
}
export interface AxeFinding {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: number;
  targets: string[];
}
export interface Overflow {
  flag: boolean;
  scrollWidth: number;
  clientWidth: number;
  offenders: { selector: string; text: string; left: number; right: number }[];
}
export interface ShotEntry {
  file: string;
  kind: 'fold' | 'full';
  /** For a full-page shot: the fold shot it belongs to (diagnostics live on the fold entry). */
  of?: string;
  route: string;
  url: string;
  finalUrl: string;
  role: RoleName;
  viewport: string;
  state: string;
  httpStatus?: number | null;
  title?: string;
  h1?: string;
  pageHeight?: number;
  fullTruncated?: boolean;
  consoleErrors?: ConsoleError[];
  failedRequests?: FailedRequest[];
  /** Write requests (POST/PUT/PATCH/DELETE) the page tried since the previous shot; the sweep blocks them. */
  blockedWrites?: string[];
  overflow?: Overflow;
  axe?: AxeFinding[] | null;
  notes?: string[];
}
export interface Redirect {
  role: RoleName;
  viewport: string;
  route: string;
  url: string;
  finalUrl: string;
}
export interface Part {
  entries: ShotEntry[];
  redirects: Redirect[];
  notes: string[];
}

export const slug = (value: string, max = 90) =>
  value
    .replace(/^https?:\/\/[^/]+/, '')
    // Shorten generated ids (user_<uuid>) to prefix-last4 so file names stay readable.
    .replace(/\b([a-z]{3,6})_[0-9a-f]{8}-[0-9a-f-]{27}\b/g, (_m, p: string) => `${p}-${_m.slice(-4)}`)
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, max) || 'home';

const tokens = new Map<RoleName, Promise<string | null>>();

/** Signs in through the API (once per worker per role) and returns the access token. */
export function tokenFor(role: RoleName): Promise<string | null> {
  if (role === 'visitor') return Promise.resolve(null);
  let pending = tokens.get(role);
  if (!pending) {
    pending = (async () => {
      const ids = loadIds();
      const email =
        role === 'new-musician'
          ? ids.accounts.newMusician
          : role === 'musician'
            ? ids.accounts.musician
            : role === 'new-hirer'
              ? ids.accounts.newHirer
              : role === 'hirer'
                ? ids.accounts.hirer
                : ids.accounts.admin;
      const api = await request.newContext();
      try {
        const response = await api.post(`${API}/auth/login`, {
          data: { email, password: role === 'admin' ? ADMIN_PASSWORD : PASSWORD },
          headers: { Origin: role === 'admin' ? ADMIN : WEB },
        });
        const body = (await response.json()) as { accessToken?: string };
        if (!response.ok() || !body.accessToken)
          throw new Error(`Sign-in as ${role} (${email}) failed: ${response.status()}`);
        return body.accessToken;
      } finally {
        await api.dispose();
      }
    })();
    tokens.set(role, pending);
  }
  return pending;
}

const KILL_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}';

interface Buffers {
  console: ConsoleError[];
  failed: FailedRequest[];
}

export interface Session {
  role: RoleName;
  vp: ViewportName;
  context: BrowserContext;
  page: Page;
  origin: string;
  part: Part;
  buf: Buffers;
  lastStatus: number | null;
  /** The renderer died (out of memory on a heavy page); the next visit() opens a fresh page. */
  crashed: boolean;
  /** Writes the guard refused since the last shot. */
  blocked: string[];
  /** Everything needed to rebuild the context if the whole browser dies. */
  options: SessionOptions;
  token: string | null;
  ownBrowser?: Browser;
  /** Set by the spec: only capture URLs matching this (UX_ROUTE). */
  close: () => Promise<void>;
}

const isLocal = (url: string) =>
  /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url) || url.startsWith('data:') || url.startsWith('blob:');

export interface SessionOptions {
  /** Do not pre-seed the "tour already seen" flags, to photograph first-visit overlays. */
  freshTour?: boolean;
  /** Use this token instead of signing in (e.g. a deliberately expired one). */
  token?: string | null;
}

async function createContext(
  browser: Browser,
  role: RoleName,
  vp: ViewportName,
  options: SessionOptions,
  token: string | null,
): Promise<BrowserContext> {
  const size = VIEWPORTS[vp];
  const mobile = size.width <= 500;
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
    baseURL: role === 'admin' ? ADMIN : WEB,
    serviceWorkers: 'block',
  });
  await context.addInitScript(
    ({ token: t, seedTour, kill }) => {
      try {
        if (t && !localStorage.getItem('verse_access_token')) localStorage.setItem('verse_access_token', t);
        if (seedTour) {
          localStorage.setItem('verse-tour-v2-jobseeker', 'done');
          localStorage.setItem('verse-tour-v2-employer', 'done');
        }
      } catch {
        /* storage blocked: the page still renders signed out */
      }
      const inject = () => {
        if (document.getElementById('ux-sweep-kill')) return;
        const style = document.createElement('style');
        style.id = 'ux-sweep-kill';
        style.textContent = kill;
        const parent = document.head || document.documentElement;
        if (parent) parent.appendChild(style);
      };
      inject();
      document.addEventListener('DOMContentLoaded', inject);
    },
    { token, seedTour: !options.freshTour, kill: KILL_CSS },
  );
  return context;
}

export async function openSession(
  browser: Browser,
  role: RoleName,
  vp: ViewportName,
  options: SessionOptions = {},
): Promise<Session> {
  const origin = role === 'admin' ? ADMIN : WEB;
  const token = options.token !== undefined ? options.token : await tokenFor(role);
  const context = await createContext(browser, role, vp, options, token);
  const page = await context.newPage();
  const buf: Buffers = { console: [], failed: [] };
  const session: Session = {
    role,
    vp,
    context,
    page,
    origin,
    part: { entries: [], redirects: [], notes: [] },
    buf,
    lastStatus: null,
    crashed: false,
    blocked: [],
    options,
    token,
    close: async () => {
      await session.context.close().catch(() => undefined);
      await session.ownBrowser?.close().catch(() => undefined);
    },
  };
  await installGuard(session);
  attachListeners(session, page);
  return session;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** The only writes a sweep may send: sign-in attempts with an address that is not an account (wrong password, wrong code) and link previews (read-only). */
const ALLOWED_WRITES = /\/api\/(auth\/(login|otp\/request|otp\/verify)|link-previews)(\?|$)/;

/**
 * The sweep must never change data: buttons such as "Remove" or "Hide from booking" act at once, so every
 * write request is refused in the browser (and recorded on the shot), except the allowlist above.
 * Analytics events are answered locally so the funnel numbers in the admin console stay clean.
 */
async function installGuard(session: Session) {
  await session.context.route('**/api/**', (route) => {
    const request = route.request();
    if (!WRITE_METHODS.has(request.method())) return route.continue();
    const { pathname } = new URL(request.url());
    if (/\/api\/events$/.test(pathname)) return route.fulfill({ status: 204, body: '' });
    if (ALLOWED_WRITES.test(request.url())) return route.continue();
    session.blocked.push(`${request.method()} ${pathname.replace(/^\/api/, '')}`);
    return route.abort('blockedbyclient');
  });
}

function attachListeners(session: Session, page: Page) {
  const { buf, role } = session;
  page.on('crash', () => {
    session.crashed = true;
    session.part.notes.push(`the page crashed at ${page.url()}`);
  });
  // A "leave this page?" prompt (unsaved profile edits) must be accepted, or the next navigation is cancelled.
  page.on(
    'dialog',
    (dialog) => void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => undefined),
  );
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location().url;
    const text = message.text().slice(0, 500);
    const external = Boolean(url) && !isLocal(url);
    buf.console.push({
      text,
      url,
      external,
      expected:
        /ERR_BLOCKED_BY_CLIENT/.test(text) || (role === 'visitor' && /\/api\/me\b/.test(url || '') && /401/.test(text)),
    });
  });
  page.on('pageerror', (error) =>
    buf.console.push({ text: `pageerror: ${error.message}`.slice(0, 500), external: false, expected: false }),
  );
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    buf.failed.push({
      url,
      status,
      method: response.request().method(),
      external: !isLocal(url),
      expected: role === 'visitor' && status === 401 && /\/api\/me(\?|$)/.test(url),
    });
  });
  page.on('requestfailed', (req) => {
    const error = req.failure()?.errorText || 'failed';
    if (/ERR_ABORTED/.test(error)) return;
    buf.failed.push({
      url: req.url(),
      status: 0,
      method: req.method(),
      error,
      external: !isLocal(req.url()),
      expected: /BLOCKED_BY_CLIENT/.test(error),
    });
  });
}

/** Replaces a crashed page with a fresh one in the same signed-in context. */
export async function reopen(session: Session) {
  await session.page.close().catch(() => undefined);
  try {
    session.page = await session.context.newPage();
  } catch {
    // The whole browser died (a renderer crash can take it down): carry on in a private one.
    session.part.notes.push('the browser died; continued in a new one');
    await session.ownBrowser?.close().catch(() => undefined);
    const browser = await chromium.launch();
    session.ownBrowser = browser;
    session.context = await createContext(browser, session.role, session.vp, session.options, session.token);
    await installGuard(session);
    session.page = await session.context.newPage();
  }
  session.crashed = false;
  attachListeners(session, session.page);
}

/** Waits for the page to be quiet: app loaded, network idle, fonts ready, skeletons gone. */
export async function settle(page: Page) {
  await page
    .waitForFunction(() => !/Loading Verse/.test(document.body?.innerText || ''), null, { timeout: 12_000 })
    .catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => document.querySelectorAll('[aria-busy="true"], .animate-pulse').length === 0, null, {
      timeout: 2_500,
    })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page
    .evaluate((css) => {
      if (document.getElementById('ux-sweep-kill')) return;
      const style = document.createElement('style');
      style.id = 'ux-sweep-kill';
      style.textContent = css;
      document.head.appendChild(style);
    }, KILL_CSS)
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

export async function visit(s: Session, url: string): Promise<number | null> {
  if (s.crashed || s.page.isClosed() || !s.context.browser()?.isConnected()) await reopen(s);
  s.buf.console.length = 0;
  s.buf.failed.length = 0;
  let status: number | null = null;
  try {
    const response = await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    status = response?.status() ?? null;
  } catch (error) {
    s.part.notes.push(`goto ${url} failed: ${(error as Error).message.split('\n')[0]}`);
  }
  s.lastStatus = status;
  await settle(s.page);
  return status;
}

export const relative = (s: Session, url: string) => {
  try {
    const parsed = new URL(url, s.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
};

/** Records a redirect probe (no screenshot): where did this role end up for this URL? */
export async function probe(s: Session, route: string, url: string) {
  await visit(s, url);
  s.part.redirects.push({ role: s.role, viewport: vpLabel(s.vp), route, url, finalUrl: relative(s, s.page.url()) });
}

async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const clientWidth = doc.clientWidth;
    const scrollWidth = Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0);
    const flag = scrollWidth > clientWidth + 2;
    const offenders: { selector: string; text: string; left: number; right: number }[] = [];
    if (flag) {
      const describe = (el: Element) => {
        const parts: string[] = [];
        let node: Element | null = el;
        for (let depth = 0; node && depth < 4 && node !== document.body; depth += 1) {
          const cls =
            typeof node.className === 'string' ? node.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls ? `.${cls}` : ''}`);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };
      const clipped = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right <= clientWidth + 2 && rect.left >= -2) continue;
        const style = getComputedStyle(el);
        if (style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue;
        if (clipped(el)) continue;
        offenders.push({
          selector: describe(el),
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        });
        if (offenders.length >= 12) break;
      }
    }
    return { flag, scrollWidth, clientWidth, offenders };
  });
}

async function runAxe(page: Page): Promise<AxeFinding[] | null> {
  if (!AXE) return null;
  try {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
  } catch {
    return null;
  }
}

async function loadLazyContent(page: Page) {
  // Scroll the page once so lazy images and reveal-on-scroll sections render, then return to the top.
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    const limit = Math.min(document.documentElement.scrollHeight, 24_000);
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(150);
}

export interface CaptureOptions {
  route: string;
  /** Requested URL (for the index). */
  url: string;
  state?: string;
  /** Skip the full-page image. */
  noFull?: boolean;
  /** Photograph the viewport where the page is scrolled to (an opened accordion), not the top. */
  keepScroll?: boolean;
  /** Skip axe for this shot. */
  noAxe?: boolean;
  notes?: string[];
  /** File name stem override (defaults to the slug of the url). */
  stem?: string;
}

/** Free space on the output disk, in MB (this machine's disk is small and shared). */
const freeMb = () => {
  try {
    const stat = statfsSync(OUT);
    return Math.floor((stat.bavail * stat.bsize) / 1_048_576);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};
const MIN_FREE_MB = Number(process.env.UX_MIN_FREE_MB || 600);

/** Takes the first-fold and (when the page is taller than the viewport) the full-page shot. */
export async function capture(s: Session, options: CaptureOptions): Promise<ShotEntry> {
  const { page } = s;
  // The disk is small and shared: wait for space to come back (up to 10 minutes) before giving up.
  for (let wait = 0; freeMb() < MIN_FREE_MB; wait += 1) {
    if (wait >= 40) throw new Error(`Stopping: less than ${MIN_FREE_MB} MB free where the screenshots are written.`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  await settle(page);
  const label = vpLabel(s.vp);
  const state = options.state ?? 'default';
  const stem = options.stem ?? slug(options.url);
  const base = `${s.role}/${stem}__${slug(state, 60)}__${label}`;
  const foldFile = `${base}.png`;
  mkdirSync(dirname(join(OUT, foldFile)), { recursive: true });

  const overflow = await measureOverflow(page).catch(() => undefined);
  const dims = await page
    .evaluate(() => ({
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      title: document.title,
      h1: (document.querySelector('h1')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    }))
    .catch(() => ({ height: 0, title: '', h1: '' }));
  const axe = options.noAxe ? null : await runAxe(page);
  const consoleErrors = [...s.buf.console];
  const failedRequests = [...s.buf.failed];
  const blockedWrites = s.blocked.splice(0);
  s.buf.console.length = 0;
  s.buf.failed.length = 0;

  if (!options.keepScroll) await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await page.screenshot({ path: join(OUT, foldFile), fullPage: false }).catch((error: Error) => {
    s.part.notes.push(`fold screenshot ${foldFile} failed: ${error.message.split('\n')[0]}`);
  });

  const entry: ShotEntry = {
    file: foldFile,
    kind: 'fold',
    route: options.route,
    url: options.url,
    finalUrl: relative(s, page.url()),
    role: s.role,
    viewport: label,
    state,
    httpStatus: s.lastStatus,
    title: dims.title,
    h1: dims.h1,
    pageHeight: dims.height,
    consoleErrors,
    failedRequests,
    blockedWrites: blockedWrites.length ? blockedWrites : undefined,
    overflow,
    axe,
    notes: options.notes,
  };
  s.part.entries.push(entry);

  if (!options.noFull && !options.keepScroll && dims.height > VIEWPORTS[s.vp].height + 30) {
    await loadLazyContent(page);
    const fullFile = `${base}__full.png`;
    const cap = 16_000;
    const truncated = dims.height > cap;
    try {
      await page.screenshot({
        path: join(OUT, fullFile),
        fullPage: true,
        ...(truncated ? { clip: { x: 0, y: 0, width: VIEWPORTS[s.vp].width, height: cap } } : {}),
      });
      s.part.entries.push({
        file: fullFile,
        kind: 'full',
        of: foldFile,
        route: options.route,
        url: options.url,
        finalUrl: entry.finalUrl,
        role: s.role,
        viewport: label,
        state,
        pageHeight: dims.height,
        fullTruncated: truncated || undefined,
      });
    } catch (error) {
      s.part.notes.push(`full screenshot ${fullFile} failed: ${(error as Error).message.split('\n')[0]}`);
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  }
  return entry;
}

/** Opens a URL and captures it (the common case). Honors the UX_ROUTE filter. */
export async function visitAndCapture(s: Session, options: CaptureOptions & { target?: string }) {
  await visit(s, options.url);
  return capture(s, options);
}

export const visible = async (locator: Locator) =>
  locator
    .first()
    .isVisible()
    .catch(() => false);

// ---- index ----------------------------------------------------------------------------------------

const PARTS = join(OUT, '.parts');

export const partFile = (role: RoleName, vp: ViewportName, kind: string) => join(PARTS, `${role}__${vp}__${kind}.json`);

/** Writes this session's results (replacing entries with the same file) and refreshes index.json. */
export function savePart(file: string, part: Part, extraIndex: () => Record<string, unknown>) {
  mkdirSync(PARTS, { recursive: true });
  let merged: Part = part;
  if (existsSync(file) && process.env.UX_PARTIAL === '1') {
    const old = JSON.parse(readFileSync(file, 'utf8')) as Part;
    const files = new Set(part.entries.map((e) => e.file));
    const probes = new Set(part.redirects.map((r) => `${r.route}|${r.url}`));
    merged = {
      entries: [...old.entries.filter((e) => !files.has(e.file)), ...part.entries],
      redirects: [...old.redirects.filter((r) => !probes.has(`${r.route}|${r.url}`)), ...part.redirects],
      notes: [...old.notes, ...part.notes],
    };
  }
  writeFileSync(`${file}.tmp`, JSON.stringify(merged));
  renameSync(`${file}.tmp`, file);
  writeIndex(extraIndex());
}

export function writeIndex(extra: Record<string, unknown>) {
  const parts = existsSync(PARTS) ? readdirSync(PARTS).filter((f) => f.endsWith('.json')) : [];
  const entries: ShotEntry[] = [];
  const redirects: Redirect[] = [];
  const notes: string[] = [];
  for (const name of parts) {
    try {
      const part = JSON.parse(readFileSync(join(PARTS, name), 'utf8')) as Part;
      entries.push(...part.entries);
      redirects.push(...part.redirects);
      notes.push(...part.notes.map((n) => `${name.replace('.json', '')}: ${n}`));
    } catch {
      /* a part being written by another worker; the next merge picks it up */
    }
  }
  // Failures the sweep causes on purpose are marked expected: ids that do not exist, wrong sign-in attempts.
  for (const entry of entries) {
    const intended = /does-not-exist/.test(entry.url) || /wrong-(password|code)/.test(entry.state);
    const expired = entry.state === 'expired-session';
    for (const failure of entry.failedRequests ?? []) {
      if ((intended || expired) && (failure.status === 404 || failure.status === 401)) failure.expected = true;
      // The seeded thread, portfolio and invoice belong to the populated accounts; anyone else gets a 404.
      const owners = /\/conversations\/conv_/.test(failure.url)
        ? ['musician', 'hirer']
        : /\/portfolios\/port_/.test(failure.url)
          ? ['musician']
          : /\/invoices\/invo_/.test(failure.url)
            ? ['hirer']
            : undefined;
      if (owners && failure.status === 404 && !owners.includes(entry.role)) failure.expected = true;
    }
    for (const error of entry.consoleErrors ?? []) {
      if ((intended || expired) && /status of (404|401)/.test(error.text)) error.expected = true;
      if (
        /status of 404/.test(error.text) &&
        /\/(conversations\/conv_|portfolios\/port_|invoices\/invo_)/.test(error.url ?? '')
      ) {
        const owners = /conv_/.test(error.url ?? '')
          ? ['musician', 'hirer']
          : /port_/.test(error.url ?? '')
            ? ['musician']
            : ['hirer'];
        if (!owners.includes(entry.role)) error.expected = true;
      }
    }
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const folds = entries.filter((e) => e.kind === 'fold');
  const count = (rows: ShotEntry[], key: 'role' | 'viewport') =>
    rows.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e[key]]: (acc[e[key]] ?? 0) + 1 }), {});
  const real = <T extends { external: boolean; expected: boolean }>(list: T[] | undefined) =>
    (list ?? []).filter((item) => !item.external && !item.expected);
  const summary = {
    shots: entries.length,
    foldShots: folds.length,
    fullPageShots: entries.length - folds.length,
    byRole: count(entries, 'role'),
    byViewport: count(entries, 'viewport'),
    shotsWithConsoleErrors: folds.filter((e) => real(e.consoleErrors).length).length,
    consoleErrors: folds.reduce((n, e) => n + real(e.consoleErrors).length, 0),
    shotsWithFailedRequests: folds.filter((e) => real(e.failedRequests).length).length,
    failedRequests: folds.reduce((n, e) => n + real(e.failedRequests).length, 0),
    externalFailuresIgnored: folds.reduce(
      (n, e) =>
        n +
        (e.failedRequests ?? []).filter((f) => f.external).length +
        (e.consoleErrors ?? []).filter((c) => c.external).length,
      0,
    ),
    shotsWithBlockedWrites: folds.filter((e) => e.blockedWrites?.length).length,
    overflowFlags: folds.filter((e) => e.overflow?.flag).length,
    axeShotsWithViolations: folds.filter((e) => e.axe?.length).length,
    axeViolations: folds.reduce((n, e) => n + (e.axe?.length ?? 0), 0),
    axeNodes: folds.reduce((n, e) => n + (e.axe ?? []).reduce((m, v) => m + v.nodes, 0), 0),
  };
  const file = join(OUT, 'index.json');
  writeFileSync(
    `${file}.tmp`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        web: WEB,
        admin: ADMIN,
        api: API,
        summary,
        ...extra,
        redirects,
        notes,
        entries,
      },
      null,
      1,
    ),
  );
  renameSync(`${file}.tmp`, file);
}

export { roleKind };
