import { expect, test, type Page } from '@playwright/test';

// Phone guard: on the main public and signed-in pages at 390 px wide, no visible text is under
// 12 px and no visible button, link or form control has a hit area under 40 px in either
// direction. Text links inside a sentence are exempt (WCAG's inline exception), as are
// visually hidden skip links. A form input/radio/checkbox counts through its label.
test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

type Role = 'jobseeker' | 'employer';
const user = (role: Role) => ({
  id: `qa-${role}`,
  name: 'QA User',
  email: 'qa@example.invalid',
  role,
  status: 'active',
  profileComplete: true,
});

async function signIn(page: Page, role: Role) {
  await page.addInitScript(() => {
    localStorage.setItem('musilynk_access_token', 'qa-token');
    for (const key of ['musilynk-tour-v2-jobseeker', 'musilynk-tour-v2-employer']) localStorage.setItem(key, 'done');
  });
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith('/me') ? { user: user(role) } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

export type Finding = { kind: 'tap' | 'text'; what: string; size: string };

/** Runs in the page: visible interactive boxes under 40 px and visible text under 12 px. */
export async function auditPage(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { kind: 'tap' | 'text'; what: string; size: string }[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
    const inlineInText = (el: Element) => {
      if (el.tagName !== 'A') return false;
      const p = el.parentElement;
      if (!p) return false;
      const own = Array.from(p.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 12);
      return own;
    };
    const targets = document.querySelectorAll(
      'a[href], button, [role="button"], [role="tab"], [role="radio"], [role="switch"], select, input:not([type="hidden"]), textarea',
    );
    for (const el of targets) {
      if (!visible(el)) continue;
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      let box = el;
      if (el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type)) {
        const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
        if (label && visible(label)) box = label;
      }
      const r = box.getBoundingClientRect();
      if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue;
      if (r.width < 1 || r.height < 1) continue;
      if (el.matches('a.sr-only, .sr-only a, [href^="#"]:not([role])') && r.width < 4) continue;
      if (inlineInText(el)) continue;
      if (r.width < 40 || r.height < 40)
        out.push({ kind: 'tap', what: describe(el), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent || '').trim()) continue;
      seen.add(el);
      if (el.closest('script, style, noscript, svg, [aria-hidden="true"]')) continue;
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) out.push({ kind: 'text', what: describe(el), size: `${size}px` });
    }
    return out;
  });
}

const publicPages = [
  '/',
  '/pricing',
  '/music-professionals',
  '/join/hiring',
  '/join/musician',
  '/auth/employer',
  '/auth/jobseeker',
];
const signedInPages: Array<[Role, string]> = [
  ['jobseeker', '/jobseeker/profile'],
  ['jobseeker', '/jobseeker/alerts'],
  ['employer', '/employer/workspace'],
  ['employer', '/employer/post-job'],
];

for (const path of publicPages) {
  test(`public ${path}: no text under 12px, no small tap targets`, async ({ page }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const findings = await auditPage(page);
    console.log('AUDIT', path, JSON.stringify(findings));
    expect(findings).toEqual([]);
  });
}
for (const [role, path] of signedInPages) {
  test(`${role} ${path}: no text under 12px, no small tap targets`, async ({ page }) => {
    await signIn(page, role);
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const findings = await auditPage(page);
    console.log('AUDIT', path, JSON.stringify(findings));
    expect(findings).toEqual([]);
  });
}
