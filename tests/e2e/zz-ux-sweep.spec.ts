import { test, type Locator, type Page } from '@playwright/test';
import {
  capture,
  openSession,
  partFile,
  probe,
  relative,
  savePart,
  settle,
  slug,
  visit,
  vpLabel,
  visitAndCapture,
  type Session,
  type ViewportName,
} from './support/ux-sweep/capture';
import { indexExtra, plan } from './support/ux-sweep/index-extra';
import {
  MISSING_ID_URLS,
  ROLES,
  TOKEN_PAGES,
  canReach,
  expand,
  loadIds,
  roleKind,
  type ConcreteTarget,
  type RoleName,
} from './support/ux-sweep/routes';

// UX sweep: a screenshot of every screen of the marketplace in every meaningful combination, for review.
//
//   UX_SWEEP=1 QA_BASE_URL=http://127.0.0.1:4600 QA_PORT_BASE=4900 \
//     flock /tmp/musilynk-playwright.lock npx playwright test tests/e2e/zz-ux-sweep.spec.ts \
//     --project=chromium-desktop --workers=3
//
// Needs the local production-mode stack (see /home/user/ux-shots/STACK.md): the API on :3300, the public
// build on :4600, the admin build on :4610, and the seeded accounts and ids (tests/e2e/support/ux-sweep/*.rb).
// Output: $UX_OUT (default /home/user/ux-shots)/<role>/<route-slug>__<state>__<viewport>[__full].png and
// index.json with one entry per shot. Optional filters: UX_ROLES, UX_VPS (desktop,mobile,small),
// UX_ROUTE (regex on the URL), UX_KINDS (routes,special,sessions), UX_INTERACTIVE=0 (no clicking), UX_AXE=0, UX_PARTIAL=1
// (merge into the existing results instead of replacing a role/viewport's results).
// It never submits anything destructive: dialogs are opened and closed, never confirmed.
test.skip(process.env.UX_SWEEP !== '1', 'UX sweep on demand only (UX_SWEEP=1).');

const csv = (value: string | undefined) =>
  value
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : undefined;
const ONLY_ROLES = csv(process.env.UX_ROLES);
const ONLY_VPS = csv(process.env.UX_VPS);
const ONLY_KINDS = csv(process.env.UX_KINDS);
const ROUTE_FILTER = process.env.UX_ROUTE ? new RegExp(process.env.UX_ROUTE) : undefined;
const INTERACTIVE = process.env.UX_INTERACTIVE !== '0';
const SWEEP_VPS: ViewportName[] = ['desktop', 'mobile', 'small'];

// ---- the plan -------------------------------------------------------------------------------------

function targetsFor(role: RoleName, vp: ViewportName): ConcreteTarget[] {
  const { ids, publicRoutes, admin } = plan();
  let targets: ConcreteTarget[];
  if (role === 'admin') {
    targets = admin.routes.flatMap((route) => {
      if (route.pattern === '/admin') {
        return [
          { pattern: '/admin', url: '/admin', audience: 'admin' as const, key: false },
          ...admin.tabs.map((tab) => ({
            pattern: '/admin',
            url: `/admin?tab=${tab}`,
            audience: 'admin' as const,
            label: tab,
            key: false,
          })),
        ];
      }
      return [{ pattern: route.pattern, url: route.pattern, audience: 'admin' as const, key: false }];
    });
  } else {
    targets = publicRoutes
      .filter((route) => !route.skipReason && !route.redirect && canReach(role, route.audience))
      .flatMap((route) => expand(route, ids));
  }
  if (vp === 'small') targets = targets.filter((target) => target.key);
  if (ROUTE_FILTER) targets = targets.filter((target) => ROUTE_FILTER.test(target.url));
  return targets;
}

// ---- interactive states ---------------------------------------------------------------------------

/** Buttons that open a dialog, panel or menu without changing anything. Never confirmed, only opened. */
const OPENERS =
  /(request|get)( a)? quote|enquire|enquiry|post( an)? urgent|urgent (need|request)|need someone|add( new)? (work|link|sample|track|act|availability|credit|member|window|slot|date)|from (a )?link|import|apply|report|verif|cancel( my)?( subscription| plan)|delete|remove|withdraw|new (portfolio|act|alert|folder|resume|page|post)|create (alert|portfolio|act|page)|invite|share|upgrade|filter|sort|edit|change (email|password)|export|close( this)?( opportunity| listing)|write|compose|book|more details|show more|advanced/i;
/** Actions that take effect at once: never clicked. */
const NEVER =
  /sign out|log ?out|checkout|pay\b|hire\b|accept|reject|decline|publish|approve|mark\b|follow|shortlist|applaud|like\b|send\b|purge|wipe|erase|reset|delete (all|demo)|remove (demo|all)|run now|seed|suspend|ban\b|refund|confirm/i;

interface Candidate {
  kind: 'tab' | 'expand' | 'open' | 'select';
  role: 'button' | 'tab' | 'combobox' | 'summary';
  label: string;
  nth: number;
}

async function candidates(page: Page): Promise<Candidate[]> {
  return page.evaluate(
    ({ opener, never }) => {
      const openerRe = new RegExp(opener, 'i');
      const neverRe = new RegExp(never, 'i');
      const scope = document.querySelector('main, [role=main], #main-content') ?? document.body;
      const nameOf = (el: Element) =>
        (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const usable = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          !(el as HTMLButtonElement).disabled &&
          el.getAttribute('aria-disabled') !== 'true' &&
          !el.closest('nav, [role=navigation], footer, [role=dialog], [role=alertdialog], [role=menu], [role=listbox]')
        );
      };
      const seen = new Map<string, number>();
      const out: { kind: string; role: string; label: string; nth: number }[] = [];
      const counts = { tab: 0, expand: 0, open: 0, select: 0 };
      const push = (kind: 'tab' | 'expand' | 'open' | 'select', role: string, el: Element, cap: number) => {
        const label = nameOf(el);
        const key = `${role}|${label}`;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        if (!label || counts[kind] >= cap) return;
        counts[kind] += 1;
        out.push({ kind, role, label, nth });
      };
      for (const el of scope.querySelectorAll('[role=tab]')) {
        if (usable(el) && el.getAttribute('aria-selected') !== 'true') push('tab', 'tab', el, 8);
        else seen.set(`tab|${nameOf(el)}`, (seen.get(`tab|${nameOf(el)}`) ?? 0) + 1);
      }
      for (const el of scope.querySelectorAll('button[role=combobox]')) {
        if (usable(el)) push('select', 'combobox', el, 4);
      }
      for (const el of scope.querySelectorAll('summary')) {
        if (usable(el) && !el.parentElement?.hasAttribute('open')) push('expand', 'summary', el, 4);
      }
      for (const el of scope.querySelectorAll('button, [role=button]')) {
        if (!usable(el) || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'combobox') continue;
        const label = nameOf(el);
        if (!label || neverRe.test(label)) {
          seen.set(`button|${label}`, (seen.get(`button|${label}`) ?? 0) + 1);
          continue;
        }
        if (el.getAttribute('aria-expanded') === 'false' && !el.getAttribute('aria-haspopup'))
          push('expand', 'button', el, 6);
        else if (el.getAttribute('aria-haspopup') === 'dialog' || openerRe.test(label)) push('open', 'button', el, 10);
        else seen.set(`button|${label}`, (seen.get(`button|${label}`) ?? 0) + 1);
      }
      return out as {
        kind: 'tab' | 'expand' | 'open' | 'select';
        role: 'button' | 'tab' | 'combobox' | 'summary';
        label: string;
        nth: number;
      }[];
    },
    { opener: OPENERS.source, never: NEVER.source },
  );
}

function locate(page: Page, c: Candidate): Locator {
  const scope = page.locator('main, [role=main], #main-content').first();
  if (c.role === 'summary') return scope.locator('summary').filter({ hasText: c.label }).nth(c.nth);
  return scope.getByRole(c.role, { name: c.label, exact: true }).nth(c.nth);
}

const OPEN_LAYER = '[role=dialog]:visible, [role=alertdialog]:visible';

async function closeLayers(page: Page) {
  for (let i = 0; i < 2; i += 1) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(150);
    const layer = page.locator(OPEN_LAYER).first();
    if (!(await layer.isVisible().catch(() => false))) return;
    await layer
      .getByRole('button', { name: /^(cancel|close|not now|keep|dismiss|no)\b/i })
      .first()
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
}

/** If the open dialog has an empty required field and a safe submit button, press it to show validation. */
async function submitDialogEmpty(s: Session, target: ConcreteTarget, state: string) {
  const dialog = s.page.locator(OPEN_LAYER).first();
  if (!(await dialog.isVisible().catch(() => false))) return;
  const hasEmptyRequired = await dialog
    .evaluate((el) =>
      [...el.querySelectorAll<HTMLInputElement>('input[required], textarea[required], [aria-required=true]')].some(
        (field) => !(field as HTMLInputElement).value,
      ),
    )
    .catch(() => false);
  if (!hasEmptyRequired) return;
  const submit = dialog
    .locator('button[type=submit], button')
    .filter({ hasText: /^(submit|send|save|apply|request|post|add|create|continue|next|report)\b/i })
    .filter({ hasNotText: NEVER })
    .first();
  if (!(await submit.isVisible().catch(() => false)) || !(await submit.isEnabled().catch(() => false))) return;
  const before = relative(s, s.page.url());
  await submit.click({ timeout: 2000 }).catch(() => undefined);
  await s.page.waitForTimeout(500);
  if (relative(s, s.page.url()) !== before) return;
  await capture(s, { route: target.pattern, url: target.url, state: `${state}__submit-empty`, noFull: true });
}

/** Clicks one candidate on a freshly loaded page and photographs what it opens. */
async function tryCandidate(s: Session, target: ConcreteTarget, c: Candidate, opts: { reload: boolean }) {
  if (opts.reload) await visit(s, target.url);
  const { page } = s;
  const loc = locate(page, c);
  if (!(await loc.isVisible().catch(() => false))) return;
  const before = relative(s, page.url());
  await loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => undefined);
  const clicked = await loc.click({ timeout: 2500 }).then(
    () => true,
    () => false,
  );
  if (!clicked) return;
  await page.waitForTimeout(450);
  if (relative(s, page.url()) !== before) {
    s.part.notes.push(`${target.url}: "${c.label}" navigated to ${relative(s, page.url())}`);
    return;
  }
  const layerOpen = await page.locator(`${OPEN_LAYER}, [role=menu]:visible, [role=listbox]:visible`).count();
  const state = `${c.kind}-${slug(c.label, 40)}${c.nth ? `-${c.nth + 1}` : ''}`;
  await capture(s, {
    route: target.pattern,
    url: target.url,
    state,
    noFull: layerOpen > 0,
    keepScroll: c.kind === 'expand' && layerOpen === 0,
    notes: layerOpen > 0 ? undefined : ['nothing opened'],
  });
  if (layerOpen > 0 && c.kind === 'open') await submitDialogEmpty(s, target, state);
  await closeLayers(page);
}

/** Tabs, disclosures, selects, and every dialog opener on the page (opened, photographed, closed). */
async function interact(s: Session, target: ConcreteTarget) {
  const all = await candidates(s.page).catch(() => []);
  // Repeated rows (one "Reshare" per post, one "Report review by <name>" per review): the first two are enough.
  const perKind = new Map<string, number>();
  const list = all.filter((c) => {
    if (s.role === 'admin' && c.kind === 'tab') return false; // every console tab is its own target already
    const key = `${c.kind}|${c.label.toLowerCase().replace(/\d+/g, '#').split(' ').slice(0, 3).join(' ')}`;
    const seen = perKind.get(key) ?? 0;
    perKind.set(key, seen + 1);
    return seen < 2;
  });
  let first = true;
  for (const c of list) {
    // The page is already loaded for the first one; reload before each later one so no state leaks.
    await tryCandidate(s, target, c, { reload: !first });
    first = false;
    if (relative(s, s.page.url()) !== relative(s, new URL(target.url, s.origin).toString())) {
      // A click moved the page somewhere else (a redirect-style action): come back.
      first = false;
    }
  }
}

/** Submits each form on the page once, empty, to photograph its validation messages. */
async function emptySubmits(s: Session, target: ConcreteTarget) {
  const count = await s.page
    .locator('main form:not([role=search]), form:not([role=search])')
    .count()
    .catch(() => 0);
  const scopeSel = 'main form:not([role=search])';
  const total =
    (await s.page
      .locator(scopeSel)
      .count()
      .catch(() => 0)) || count;
  for (let i = 0; i < Math.min(total, 4); i += 1) {
    await visit(s, target.url);
    const form = s.page.locator(scopeSel).nth(i);
    if (!(await form.isVisible().catch(() => false))) continue;
    const hasFields = await form.locator('input:not([type=hidden]):not([type=checkbox]), textarea').count();
    if (!hasFields) continue;
    const submit = form.locator('button[type=submit], button:not([type])').filter({ hasNotText: NEVER }).last();
    if (!(await submit.isVisible().catch(() => false)) || !(await submit.isEnabled().catch(() => false))) continue;
    const before = relative(s, s.page.url());
    await submit.click({ timeout: 2500 }).catch(() => undefined);
    await s.page.waitForTimeout(600);
    if (relative(s, s.page.url()) !== before) continue;
    await capture(s, { route: target.pattern, url: target.url, state: `empty-submit${i ? `-${i + 1}` : ''}` });
  }
}

// ---- wizards ---------------------------------------------------------------------------------------

async function autofill(page: Page) {
  const fields = page.locator(
    'main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([role=combobox]), main textarea',
  );
  const n = Math.min(await fields.count().catch(() => 0), 14);
  for (let i = 0; i < n; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false)) || !(await field.isEditable().catch(() => false))) continue;
    if ((await field.inputValue().catch(() => 'x')) !== '') continue;
    const hint = (
      (await field
        .evaluate(
          (el) =>
            `${el.getAttribute('type') || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${(el as HTMLInputElement).labels?.[0]?.textContent || ''}`,
        )
        .catch(() => '')) || ''
    ).toLowerCase();
    const isTextarea = await field.evaluate((el) => el.tagName === 'TEXTAREA').catch(() => false);
    const type = (await field.getAttribute('type').catch(() => '')) || '';
    let value = 'Ux sweep sample text';
    if (isTextarea) {
      value =
        'Ux sweep sample text that is long enough to satisfy a minimum length check on the form, with detail about the work.';
    } else if (type === 'datetime-local') value = '2026-12-12T19:30';
    else if (type === 'date') value = '2026-12-12';
    else if (type === 'time') value = '19:30';
    else if (type === 'email' || /email/.test(hint)) value = 'ux.sweep.wizard@musilynk.local';
    else if (type === 'password' || /password/.test(hint)) value = 'UxSweepPass123!';
    else if (type === 'tel' || /phone|mobile|whatsapp/.test(hint)) value = '9876543210';
    else if (type === 'url' || /url|link|website|http/.test(hint))
      value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    else if (type === 'number' || /rate|fee|budget|pay|amount|salary|years|slots|experience/.test(hint))
      value = '15000';
    else if (/name/.test(hint)) value = 'Ux Sweep';
    await field.fill(value, { timeout: 1500 }).catch(() => undefined);
  }
  // Searchable pickers (city, location, genres): type and take the first suggestion.
  const pickers = page.locator('main input[role=combobox]');
  const pc = Math.min(await pickers.count().catch(() => 0), 4);
  for (let i = 0; i < pc; i += 1) {
    const picker = pickers.nth(i);
    if (!(await picker.isVisible().catch(() => false))) continue;
    if ((await picker.inputValue().catch(() => 'x')) !== '') continue;
    const label = (
      (await picker
        .evaluate(
          (el) => `${el.getAttribute('aria-label') || ''} ${(el as HTMLInputElement).labels?.[0]?.textContent || ''}`,
        )
        .catch(() => '')) || ''
    ).toLowerCase();
    const wanted = /role|instrument/.test(label) ? 'Drummer' : /genre/.test(label) ? 'Rock' : 'Mumbai';
    await picker.fill(wanted, { timeout: 1500 }).catch(() => undefined);
    await picker.press('Enter').catch(() => undefined);
  }
  // Dropdowns still showing their placeholder: take the first option.
  const dropdowns = page.locator('main button[role=combobox]');
  const dc = Math.min(await dropdowns.count().catch(() => 0), 4);
  for (let i = 0; i < dc; i += 1) {
    const text =
      (await dropdowns
        .nth(i)
        .textContent()
        .catch(() => '')) || '';
    if (!/choose|select|pick/i.test(text)) continue;
    await dropdowns
      .nth(i)
      .click({ timeout: 1500 })
      .catch(() => undefined);
    await page
      .getByRole('option')
      .first()
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
  // Required unchecked consent boxes.
  const boxes = page.locator('main input[type=checkbox]');
  const bc = Math.min(await boxes.count().catch(() => 0), 4);
  for (let i = 0; i < bc; i += 1) {
    const box = boxes.nth(i);
    const text = await box
      .evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent || el.getAttribute('aria-label') || '')
      .catch(() => '');
    if (/agree|terms|consent|accept/i.test(text) && !(await box.isChecked().catch(() => true)))
      await box.check({ timeout: 1500 }).catch(() => undefined);
  }
}

async function chooseSomething(page: Page) {
  // Stuck on a required choice: press the first unpressed chip and the first select option.
  await page
    .locator('main button[aria-pressed="false"]')
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
  const selects = page.locator('main button[role=combobox]');
  const n = Math.min(await selects.count().catch(() => 0), 3);
  for (let i = 0; i < n; i += 1) {
    const text =
      (await selects
        .nth(i)
        .textContent()
        .catch(() => '')) || '';
    if (!/select|choose|pick|^\s*$/i.test(text)) continue;
    await selects
      .nth(i)
      .click({ timeout: 1500 })
      .catch(() => undefined);
    await page
      .getByRole('option')
      .first()
      .click({ timeout: 1500 })
      .catch(() => undefined);
  }
  await page
    .locator('main [role=radio][aria-checked="false"]')
    .first()
    .click({ timeout: 1500 })
    .catch(() => undefined);
}

const NEXT = /^(next|continue)\b/i;

/** Which wizard step is showing: its "Step n of m" line and its heading (main text also changes on validation errors). */
const stepSignature = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main, [role=main]') ?? document.body;
    const heading =
      [...main.querySelectorAll('h2')].find((h) => h.getBoundingClientRect().height > 0)?.textContent?.trim() ?? '';
    const step = (main.textContent ?? '').match(/Step\s+\d+\s+of\s+\d+/i)?.[0] ?? '';
    return `${step}|${heading}`;
  });

/** Photographs every step of a multi-step form: each step as it opens, then its empty-Next errors. */
async function stepWalk(s: Session, route: string, url: string, prefix: string, maxSteps = 8) {
  await visit(s, url);
  const startNew = s.page.getByRole('button', { name: /start a new one|new listing|start fresh/i }).first();
  if (await startNew.isVisible().catch(() => false)) {
    await capture(s, { route, url, state: `${prefix}-draft-offer` });
    await startNew.click({ timeout: 2000 }).catch(() => undefined);
    await settle(s.page);
  }
  for (let step = 1; step <= maxSteps; step += 1) {
    await capture(s, { route, url, state: `${prefix}-step${step}` });
    const next = s.page.locator('main button:visible, main a[role=button]:visible').filter({ hasText: NEXT }).first();
    const visibleNext = await next.isVisible().catch(() => false);
    if (!visibleNext || !(await next.isEnabled().catch(() => false))) {
      // No Next on the last step is the normal end; a Next that is there but disabled is worth a note.
      if (visibleNext) s.part.notes.push(`${url}: wizard stopped at step ${step} (Next is disabled)`);
      return;
    }
    const before = await stepSignature(s.page);
    // First press it empty: validation messages are a state worth seeing.
    await next.click({ timeout: 2500 }).catch(() => undefined);
    await s.page.waitForTimeout(500);
    let after = await stepSignature(s.page);
    if (after === before) {
      await capture(s, { route, url, state: `${prefix}-step${step}-empty-next` });
      await autofill(s.page);
      await next.click({ timeout: 2500 }).catch(() => undefined);
      await s.page.waitForTimeout(600);
      after = await stepSignature(s.page);
    }
    if (after === before) {
      await chooseSomething(s.page);
      await autofill(s.page);
      await next.click({ timeout: 2500 }).catch(() => undefined);
      await s.page.waitForTimeout(600);
      after = await stepSignature(s.page);
    }
    if (after === before) {
      await capture(s, { route, url, state: `${prefix}-step${step}-stuck` });
      s.part.notes.push(`${url}: wizard stopped at step ${step} (could not satisfy the step automatically)`);
      return;
    }
  }
}

// ---- special flows ---------------------------------------------------------------------------------

const dashboardFor = (role: RoleName) =>
  roleKind(role) === 'employer'
    ? '/employer'
    : roleKind(role) === 'jobseeker'
      ? '/jobseeker'
      : role === 'admin'
        ? '/admin'
        : '/';

async function menus(s: Session) {
  const urls = ['/'];
  if (s.role !== 'visitor') urls.push(dashboardFor(s.role));
  if (s.role === 'musician' || s.role === 'new-musician') urls.push('/jobseeker/profile');
  if (s.role === 'hirer' || s.role === 'new-hirer') urls.push('/employer/post-job');
  const triggers: [string, (page: Page) => Locator][] = [
    ['main-menu', (p) => p.getByRole('button', { name: /open navigation/i })],
    ['account-menu', (p) => p.getByRole('button', { name: /open account menu/i })],
    ['account-menu-testid', (p) => p.getByTestId('account-menu')],
    ['workspace-tools', (p) => p.getByRole('button', { name: /open all workspace tools/i })],
    ['identity-switcher', (p) => p.getByTestId('identity-switcher')],
    ['city-selector', (p) => p.getByRole('combobox', { name: /now booking in/i })],
    ['notifications', (p) => p.getByRole('button', { name: /notifications/i })],
  ];
  for (const url of urls) {
    for (const [name, make] of triggers) {
      await visit(s, url);
      const trigger = make(s.page).first();
      if (!(await trigger.isVisible().catch(() => false))) continue;
      await trigger.click({ timeout: 2500 }).catch(() => undefined);
      await s.page.waitForTimeout(450);
      const before = relative(s, new URL(url, s.origin).toString());
      if (relative(s, s.page.url()) !== before) continue;
      await capture(s, { route: url, url, state: `menu-${name}`, noFull: true });
      await closeLayers(s.page);
    }
  }
}

async function emptySearches(s: Session) {
  const urls = ['/search', '/music-jobs', '/music-professionals', '/book-music'];
  if (roleKind(s.role) === 'jobseeker') urls.push('/jobseeker/jobs');
  if (roleKind(s.role) === 'employer') urls.push('/employer/candidates', '/employer/book-talent');
  if (roleKind(s.role) === 'jobseeker') urls.push('/jobseeker/book-talent');
  for (const url of urls) {
    await visit(s, url);
    const input = s.page
      .locator(
        'main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=email]):not([type=password]):not([role=combobox])',
      )
      .first();
    if (!(await input.isVisible().catch(() => false))) {
      s.part.notes.push(`${url}: no search field found for the empty-search state`);
      continue;
    }
    await input.fill('zzqxj no such musician').catch(() => undefined);
    await input.press('Enter').catch(() => undefined);
    await s.page
      .getByRole('button', { name: /^search\b/i })
      .first()
      .click({ timeout: 1200 })
      .catch(() => undefined);
    await s.page.waitForTimeout(1200);
    await capture(s, { route: url, url, state: 'empty-search' });
  }
}

async function missing(s: Session) {
  for (const url of MISSING_ID_URLS) {
    await visitAndCapture(s, { route: url.replace(/\/[^/]+$/, '/:id'), url, state: 'not-found' });
  }
  if (roleKind(s.role) === 'jobseeker' || roleKind(s.role) === 'employer') {
    const base = roleKind(s.role) === 'jobseeker' ? '/jobseeker' : '/employer';
    await visitAndCapture(s, { route: `${base}/*`, url: `${base}/does-not-exist`, state: 'not-found' });
    await visitAndCapture(s, { route: `${base}/jobs/:id`, url: `${base}/jobs/does-not-exist`, state: 'not-found' });
  }
}

async function wizards(s: Session) {
  const ids = loadIds();
  if (s.role === 'visitor') {
    await stepWalk(s, '/join/:audience', '/join/musician', 'join-musician');
    await stepWalk(s, '/join/:audience', '/join/hiring', 'join-hiring');
    await stepWalk(s, '/urgent', '/urgent', 'urgent');
    // Sign-in with an address that is not an account: the emailed-code step and its wrong-code error ...
    await visit(s, '/auth/jobseeker');
    const codeEmail = s.page.getByLabel(/email/i).first();
    if (await codeEmail.isVisible().catch(() => false)) {
      await codeEmail.fill('nobody.here@musilynk.local');
      await s.page
        .getByRole('button', { name: /email me.*code/i })
        .first()
        .click({ timeout: 2500 })
        .catch(() => undefined);
      await s.page.waitForTimeout(1000);
      await capture(s, { route: '/auth/:userType', url: '/auth/jobseeker', state: 'code-step' });
      const code = s.page.getByLabel(/code/i).first();
      if (await code.isVisible().catch(() => false)) {
        await code.fill('000000');
        await s.page
          .getByRole('button', { name: /verify and sign in/i })
          .click({ timeout: 2500 })
          .catch(() => undefined);
        await s.page.waitForTimeout(1000);
        await capture(s, { route: '/auth/:userType', url: '/auth/jobseeker', state: 'wrong-code' });
      }
    }
    // ... and the password form with a wrong password.
    await visit(s, '/auth/jobseeker');
    await s.page
      .getByRole('button', { name: /use password instead/i })
      .click({ timeout: 2000 })
      .catch(() => undefined);
    await capture(s, { route: '/auth/:userType', url: '/auth/jobseeker', state: 'password-form' });
    const email = s.page.getByLabel(/email/i).first();
    const password = s.page.getByLabel(/password/i).first();
    if ((await email.isVisible().catch(() => false)) && (await password.isVisible().catch(() => false))) {
      await email.fill('nobody.here@musilynk.local');
      await password.fill('Wrong-password-1');
      await s.page
        .getByRole('button', { name: /^sign in/i })
        .first()
        .click({ timeout: 2500 })
        .catch(() => undefined);
      await s.page.waitForTimeout(1000);
      await capture(s, { route: '/auth/:userType', url: '/auth/jobseeker', state: 'wrong-password' });
    }
  }
  if (s.role === 'new-hirer' || s.role === 'hirer') {
    await stepWalk(s, '/employer/post-job', '/employer/post-job', 'post-job', 6);
    await stepWalk(s, '/employer/urgent', '/employer/urgent', 'urgent', 5);
    await stepWalk(s, '/employer/profile', '/employer/profile', 'profile', 6);
    await stepWalk(s, '/employer/post-job', `/employer/post-job?edit=${ids.jobId}`, 'post-job-edit', 6);
  }
  if (s.role === 'new-musician' || s.role === 'musician') {
    await stepWalk(s, '/jobseeker/profile', '/jobseeker/profile', 'profile', 6);
    await stepWalk(s, '/jobseeker/library', '/jobseeker/library', 'library-add', 4);
  }
}

// ---- the tests -------------------------------------------------------------------------------------

const wanted = (kind: string) => !ONLY_KINDS || ONLY_KINDS.includes(kind);
const roles = ROLES.filter((role) => !ONLY_ROLES || ONLY_ROLES.includes(role));
const vps = SWEEP_VPS.filter((vp) => !ONLY_VPS || ONLY_VPS.includes(vp));

test.describe.configure({ mode: 'parallel' });

for (const role of roles) {
  for (const vp of vps) {
    if (role === 'admin' && vp === 'small') continue;

    if (wanted('routes')) {
      test(`routes: ${role} @ ${vpLabel(vp)}`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium-desktop', 'The sweep sets its own viewports; run one project.');
        test.setTimeout(4 * 60 * 60 * 1000);
        const s = await openSession(browser, role, vp);
        try {
          for (const target of targetsFor(role, vp)) {
            const done = await visitAndCapture(s, {
              route: target.pattern,
              url: target.url,
              stem: slug(target.url),
              notes: TOKEN_PAGES.includes(target.pattern) ? ['opened without an email token'] : undefined,
            }).then(
              () => true,
              (error: Error) => {
                s.part.notes.push(`${target.url}: capture failed: ${error.message.split('\n')[0]}`);
                return false;
              },
            );
            if (done && INTERACTIVE && vp !== 'small') {
              await interact(s, target).catch((error: Error) =>
                s.part.notes.push(`${target.url}: interaction failed: ${error.message.split('\n')[0]}`),
              );
              if (role === 'visitor' || role === 'new-musician' || role === 'new-hirer') {
                await emptySubmits(s, target).catch((error: Error) =>
                  s.part.notes.push(`${target.url}: empty submit failed: ${error.message.split('\n')[0]}`),
                );
              }
            }
          }
          // Where do the other roles end up on routes they cannot reach? (desktop only; no screenshots)
          if (vp === 'desktop' && role !== 'admin' && !ROUTE_FILTER) {
            const { ids, publicRoutes } = plan();
            for (const route of publicRoutes) {
              if (route.skipReason) continue;
              if (!route.redirect && canReach(role, route.audience)) continue;
              const target = expand(route.redirect ? { ...route, audience: 'public' } : route, ids)[0];
              await probe(s, route.pattern, target.url);
            }
          }
        } finally {
          savePart(partFile(role, vp, 'routes'), s.part, indexExtra);
          await s.close();
        }
      });
    }

    if (wanted('special') && vp !== 'small') {
      test(`special flows: ${role} @ ${vpLabel(vp)}`, async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium-desktop', 'The sweep sets its own viewports; run one project.');
        test.setTimeout(2 * 60 * 60 * 1000);
        const s = await openSession(browser, role, vp);
        const guard = async (name: string, run: () => Promise<void>) =>
          run().catch((error: Error) => s.part.notes.push(`${name}: ${error.message.split('\n')[0]}`));
        try {
          await guard('menus', () => menus(s));
          if (role === 'admin') return;
          await guard('empty search', () => emptySearches(s));
          await guard('not found', () => missing(s));
          await guard('wizards', () => wizards(s));
        } finally {
          savePart(partFile(role, vp, 'special'), s.part, indexExtra);
          await s.close();
        }
      });
    }
  }
}

// Sessions that fail on purpose, and the first visit to a dashboard (product tour not yet seen).
for (const vp of vps.filter((v) => v !== 'small')) {
  if (!wanted('sessions') && !wanted('special')) break;
  test(`signed-out and expired sessions @ ${vpLabel(vp)}`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'The sweep sets its own viewports; run one project.');
    test.setTimeout(60 * 60 * 1000);
    const urls: [RoleName, string, string][] = [
      ['musician', '/jobseeker', 'expired-session'],
      ['musician', '/jobseeker/messages', 'expired-session'],
      ['hirer', '/employer', 'expired-session'],
      ['hirer', '/employer/post-job', 'expired-session'],
      ['admin', '/admin', 'expired-session'],
    ];
    const parts: Session[] = [];
    try {
      for (const [role, url, state] of urls) {
        if (ONLY_ROLES && !ONLY_ROLES.includes(role)) continue;
        const s = await openSession(browser, role, vp, { token: 'expired-session-token' });
        parts.push(s);
        await visitAndCapture(s, { route: url, url, state, stem: slug(url) });
        await s.close();
      }
      // Visitors on protected pages (redirect to sign-in) and on the admin site.
      const v = await openSession(browser, 'visitor', vp);
      parts.push(v);
      for (const url of ['/jobseeker', '/employer', '/stage', '/employer/post-job']) {
        await visitAndCapture(v, { route: url, url, state: 'visitor-redirect', stem: slug(url) });
      }
      await v.close();
      const a = await openSession(browser, 'admin', vp, { token: null });
      parts.push(a);
      for (const url of ['/', '/admin', '/admin/tester']) {
        await visitAndCapture(a, { route: url, url, state: 'signed-out', stem: slug(url) });
      }
      await emptySubmits(a, { pattern: '/', url: '/', audience: 'admin' });
      await a.close();
      // First visit: the product tour and any onboarding overlay (flags not pre-seeded).
      for (const role of ['new-musician', 'musician', 'new-hirer', 'hirer'] as RoleName[]) {
        if (ONLY_ROLES && !ONLY_ROLES.includes(role)) continue;
        const f = await openSession(browser, role, vp, { freshTour: true });
        parts.push(f);
        const url = dashboardFor(role);
        await visitAndCapture(f, { route: url, url, state: 'first-visit', stem: slug(url) });
        await f.close();
      }
    } finally {
      for (const p of parts) await p.close();
      const merged = {
        entries: parts.flatMap((p) => p.part.entries),
        redirects: parts.flatMap((p) => p.part.redirects),
        notes: parts.flatMap((p) => p.part.notes),
      };
      savePart(partFile('visitor', vp, 'sessions'), merged, indexExtra);
    }
  });
}
