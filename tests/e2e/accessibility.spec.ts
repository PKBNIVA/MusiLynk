import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_PAGE_META } from '../../src/app/lib/siteMeta';
import { accessibilityRoutes, fixtureActs, fixtureJobs, fixtureTalent, openSettledPage } from './qa-helpers';
import {
  HIRE_PAGE_FIXTURE,
  RATES_PAGE_FIXTURE,
  signedInScreens,
  signInForAccessibility,
} from './support/accessibility-fixtures';
import { CONVERSATION_ID, REPORT_JOB_ID, signInWithDialogFixtures } from './support/dialog-fixtures';

// The accessibility gate (CI job `accessibility` in .github/workflows/rails-and-web.yml). It runs axe-core's
// WCAG 2.1 A/AA rules over every public route scripts/prerender-heads.mjs bakes a head or a body for, the
// signed-in core screens against the mocked API, and the in-app dialogs, on the desktop and phone projects
// plus a small iphone-se smoke subset (playwright.config.ts). Any violation fails the route: a serious or
// critical one always, a moderate or minor one unless it is listed in ACCEPTED below with the design
// decision it waits on.
//
// Runtime is the budget (the CI job has to finish in under four minutes), and axe itself is the cost, about
// one analyse per test. So: every route runs on chromium-desktop; chromium-mobile (Pixel 7) repeats all of
// them except the prose-only pages tagged @desktop-only, which share one template with a page that does run
// there; the 320 px iPhone SE project repeats only the tests tagged @smoke. Pixel 7 is the chromium-mobile
// device already, so there is no separate pixel-7 project.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Findings that need a design decision rather than a local fix, so they are reported (as a test annotation
 * and in the attached axe-violations.json) instead of failing the gate. Only moderate and minor findings can
 * be accepted; a serious or critical violation always fails. Keep the list short and each entry dated.
 */
const ACCEPTED: { path: RegExp; rule: string; impact: 'minor' | 'moderate'; reason: string }[] = [];

const describeViolation = (v: { impact?: string | null; id: string; help: string; nodes: { target: unknown[] }[] }) =>
  `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length}) ${v.nodes
    .slice(0, 3)
    .map((n) => n.target.join(' '))
    .join(' | ')}`;

/** Runs axe over the page (or `scope` within it), attaches the findings and fails on any violation not accepted. */
async function expectNoViolations(page: Page, testInfo: TestInfo, path: string, scope?: string) {
  // resultTypes keeps axe from serialising the passing nodes it would otherwise return, which is most of
  // its output on a populated page; only violations are read here. options() replaces the builder's options,
  // so it must come before withTags (which sets runOnly) or the tag filter is silently dropped.
  let builder = new AxeBuilder({ page }).options({ resultTypes: ['violations'] }).withTags(WCAG_TAGS);
  if (scope) builder = builder.include(scope);
  const { violations } = await builder.analyze();
  if (violations.length) {
    await testInfo.attach('axe-violations.json', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  }
  const accepted = violations.filter((v) =>
    ACCEPTED.some((a) => a.rule === v.id && a.impact === v.impact && a.path.test(path)),
  );
  for (const v of accepted) {
    testInfo.annotations.push({ type: 'accepted-a11y-finding', description: describeViolation(v) });
  }
  const failing = violations.filter((v) => !accepted.includes(v));
  expect(failing, failing.map(describeViolation).join('\n')).toEqual([]);
}

/** Waits until the page has finished loading its data: no pending requests, no loading status, no busy region. */
async function settle(page: Page, ready?: string | RegExp) {
  await page.waitForLoadState('networkidle');
  // `visible` because a phone hides the list a thread was opened from while still rendering its preview text.
  if (ready) await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator('[role="status"]:has-text("Loading"), [aria-busy="true"]')).toHaveCount(0);
  await page.waitForTimeout(150);
}

// ---- Public routes --------------------------------------------------------------------------------------
// Every path in PUBLIC_PAGE_META (prerender-heads.mjs's ROUTES) plus the routes the older sweep already
// covered. The record-page patterns (PRERENDERED_SHELLS) open the first entry of the mocked directory
// fixtures; the hire and rates pages open one representative each of the role x city families.
const recordPages: Record<string, string> = {
  '/professionals/:id': `/professionals/${fixtureTalent[0].id}`,
  '/acts/:id': `/acts/${fixtureActs[0].id}`,
  '/opportunities/:id': `/opportunities/${fixtureJobs[0].id}`,
};
const metaRoutes = Object.entries(PUBLIC_PAGE_META).map(
  ([path, meta]) => [meta.title, recordPages[path] ?? path] as const,
);
const seoRoutes = [
  ['Hire page (role x city)', '/hire/drummer/mumbai'],
  ['Rates page (city)', '/rates/mumbai'],
] as const;
const seoFixtures: Record<string, Record<string, unknown>> = {
  '/hire/drummer/mumbai': { '/api/public/hire-pages/drummer/mumbai': HIRE_PAGE_FIXTURE },
  '/rates/mumbai': { '/api/public/rates/mumbai': RATES_PAGE_FIXTURE },
};
const publicRoutes = [...accessibilityRoutes, ...metaRoutes, ...seoRoutes].filter(
  ([, path], index, all) => all.findIndex(([, other]) => other === path) === index,
);

// Prose pages that share the legal/document template with /terms (which does run on phones), so a second
// viewport adds an axe run and no new markup. Everything else runs on chromium-desktop and chromium-mobile.
const DESKTOP_ONLY = new Set(['/privacy', '/refund-policy', '/accessibility', '/community-guidelines', '/credits']);
// The iphone-se project's subset: one page per layout family, the narrowest-viewport risks (wrapping cards,
// the nav menu, filter bars, the thread view).
const SMOKE_PUBLIC = new Set([
  '/',
  '/search',
  '/auth/jobseeker',
  '/hire/drummer/mumbai',
  recordPages['/professionals/:id'],
]);
const SMOKE_SIGNED_IN = new Set(['Musician dashboard', 'Messages with an open thread']);
const publicTags = (path: string) => [
  '@sweep',
  ...(SMOKE_PUBLIC.has(path) ? ['@smoke'] : []),
  ...(DESKTOP_ONLY.has(path) ? ['@desktop-only'] : []),
];

/** The literal paths of an exported array or object in scripts/prerender-heads.mjs. */
function prerenderedPaths(source: string, name: string) {
  const block = source.match(new RegExp(`export const ${name} = [\\[{]([\\s\\S]*?)[\\]}];`));
  expect(block, `${name} not found in scripts/prerender-heads.mjs`).not.toBeNull();
  return [...block![1].matchAll(/'(\/[^']*)'/g)].map((m) => m[1]);
}

test.describe('WCAG accessibility and colour contrast', () => {
  // A file check, not a page: one project is enough.
  test('every route prerender-heads.mjs writes is in this sweep', { tag: '@desktop-only' }, () => {
    const source = readFileSync(join(process.cwd(), 'scripts', 'prerender-heads.mjs'), 'utf8');
    const swept = new Set(publicRoutes.map(([, path]) => path));
    const missing = [
      ...prerenderedPaths(source, 'PRERENDERED_PATHS').filter((path) => !swept.has(path)),
      ...prerenderedPaths(source, 'PRERENDERED_SHELLS').filter((pattern) => !(pattern in recordPages)),
      ...Object.keys(PUBLIC_PAGE_META).filter((path) => !swept.has(recordPages[path] ?? path)),
    ];
    expect(missing, 'Add these routes to the accessibility sweep (tests/e2e/accessibility.spec.ts)').toEqual([]);
  });

  for (const [name, path] of publicRoutes) {
    test(
      `${name} has no automatically detectable WCAG A/AA violations`,
      { tag: publicTags(path) },
      async ({ page }, testInfo) => {
        await openSettledPage(page, path, seoFixtures[path]);
        await settle(page);
        await expectNoViolations(page, testInfo, path);
      },
    );
  }
});

// ---- Signed-in core screens ------------------------------------------------------------------------------
test.describe('WCAG accessibility of the signed-in core screens', () => {
  test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

  for (const screen of signedInScreens) {
    test(
      `${screen.name} has no automatically detectable WCAG A/AA violations`,
      { tag: SMOKE_SIGNED_IN.has(screen.name) ? ['@sweep', '@smoke'] : '@sweep' },
      async ({ page }, testInfo) => {
        await signInForAccessibility(page, screen.role);
        await page.goto(screen.path);
        await settle(page, screen.ready);
        await expectNoViolations(page, testInfo, screen.path);
      },
    );
  }
});

// ---- Dialogs and forms -----------------------------------------------------------------------------------
test.describe('WCAG accessibility of in-app dialogs and signed-in forms', () => {
  test.skip(Boolean(process.env.QA_BASE_URL) || process.env.QA_INTEGRATION === 'true', 'Uses local API fixtures only.');

  const scenarios = [
    {
      name: 'Conversation report dialog',
      path: `/jobseeker/messages?c=${CONVERSATION_ID}`,
      open: 'report-conversation',
      dialog: 'Report Pushy Person',
    },
    {
      name: 'Listing report dialog',
      path: `/jobseeker/jobs/${REPORT_JOB_ID}`,
      open: 'Report opportunity',
      dialog: 'Report this opportunity',
    },
    {
      name: 'Verification request dialog',
      path: '/jobseeker/profile',
      open: 'Request verification',
      dialog: 'Request verification',
    },
  ];
  for (const scenario of scenarios) {
    test(`${scenario.name} has no automatically detectable WCAG A/AA violations`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await signInWithDialogFixtures(page);
      await page.goto(scenario.path);
      const trigger = scenario.open.includes('-')
        ? page.getByTestId(scenario.open)
        : page.getByRole('button', { name: scenario.open });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: scenario.dialog });
      await expect(dialog).toBeVisible();
      // Include the error state, which adds role=alert and aria-invalid content.
      await dialog.getByRole('button', { name: /Send report|Submit for review/ }).click();
      await expect(dialog.getByText(/Choose a reason|Add a link/)).toBeVisible();
      await expectNoViolations(page, testInfo, scenario.path, '[role="dialog"]');
    });
  }

  for (const [name, path, ready] of [
    ['Profile setup form', '/jobseeker/profile', 'Headline'],
    ['Job search', '/jobseeker/jobs', 'Search opportunities'],
  ] as const) {
    test(`${name} controls all have accessible labels`, async ({ page }) => {
      await signInWithDialogFixtures(page);
      await page.goto(path);
      await expect(page.getByLabel(ready, { exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withRules(['label', 'select-name', 'button-name', 'nested-interactive'])
        .analyze();
      expect(
        result.violations,
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('\n'),
      ).toEqual([]);
    });
  }
});

// Phase 3 fixes (P3-01, 05, 06, 09): a plain keyboard/mouse-interaction check for the pieces axe
// cannot judge by itself — a real focus outline appearing, hover feedback appearing, the skip
// link's target being reachable, and a toast surviving at least 4s.
test.describe('Phase 3 UX regressions', () => {
  test('a bespoke input not built on the shared Input primitive still gets a visible focus ring (P3-01)', async ({
    page,
  }) => {
    // The nav search box is desktop-only (`hidden lg:block`); pin the viewport so this assertion
    // doesn't depend on which device a project runs it under.
    await page.setViewportSize({ width: 1280, height: 900 });
    await openSettledPage(page, '/pricing');
    const search = page.locator('#public-search');
    await search.focus();
    await expect(search).toBeFocused();
    const outline = await search.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('a plain footer link with no hover styling of its own still shows hover feedback (P3-05)', async ({ page }) => {
    await openSettledPage(page, '/about');
    // The legal pages' related-page chips now carry their own hover classes, so add a bare link
    // to check the global fallback rule itself.
    await page.evaluate(() => {
      const bare = document.createElement('a');
      bare.href = '/terms';
      bare.textContent = 'Plain terms link';
      document.querySelector('main')!.append(bare);
    });
    const link = page.getByRole('link', { name: 'Plain terms link', exact: true });
    const before = await link.evaluate((el) => getComputedStyle(el).opacity);
    await link.hover();
    await expect.poll(() => link.evaluate((el) => getComputedStyle(el).opacity)).not.toBe(before);
  });

  test("the skip link's target exists and is reachable by keyboard (P3-09)", async ({ page }) => {
    await openSettledPage(page, '/');
    // sr-only until focused, so a real keyboard user reaches it by Tab, not a pointer click.
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toHaveAttribute('href', '#main');
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('a toast stays visible for at least 4s (P3-06)', async ({ page }) => {
    await openSettledPage(page, '/forgot-password');
    // Force a response that makes ForgotPassword raise a toast (the plain success path shows no
    // toast at all, and the catch-all API fixture above answers unmatched requests with `{}`).
    await page.route('**/api/auth/forgot-password', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, debugLink: 'https://musilynk.local/reset/qa-fixture' }),
      }),
    );
    await page.getByLabel('Email').fill('qa+demo-ux1000-professional-0001@example.invalid');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(4000);
    await expect(toast).toBeVisible();
  });
});
