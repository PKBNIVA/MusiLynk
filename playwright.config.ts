import { defineConfig, devices } from '@playwright/test';

const liveBaseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '');
// Local servers use four consecutive ports from QA_PORT_BASE (default 4173, which is what CI uses):
//   base     the app under test (vite preview)      base + 1  the app built with a fake Sentry DSN
//   base + 2 the stand-in Sentry ingest endpoint    base + 3  the separate admin site
// Two runs on one machine (two worktrees, or two agents) must use different bases, e.g.
// QA_PORT_BASE=4273 and QA_PORT_BASE=4373, or they will reuse each other's servers. Runs that share
// a base must still be serial: see docs/qa/TESTER.md.
const portBase = Number(process.env.QA_PORT_BASE || 4173);
if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65_531) {
  throw new Error(`QA_PORT_BASE must be a whole number from 1024 to 65531, got "${process.env.QA_PORT_BASE}".`);
}
const localOrigin = (offset: number) => `http://127.0.0.1:${portBase + offset}`;
const appUrl = localOrigin(0);
const sentryBuildUrl = localOrigin(1);
const sentrySinkUrl = localOrigin(2);
// error-monitoring.spec.ts reads these from the environment Playwright hands its workers.
process.env.QA_SENTRY_BASE_URL ??= sentryBuildUrl;
process.env.QA_SENTRY_SINK_URL ??= sentrySinkUrl;
const fullMatrix = process.env.QA_FULL_MATRIX === 'true';
const integrationRun = process.env.QA_INTEGRATION === 'true';
// QA_APP_SERVER_ONLY=true starts the app server alone (no Sentry stand-in, no Sentry build, no admin
// build) and drops the admin project. The `accessibility` CI job (rails-and-web.yml) sets it because
// tests/e2e/accessibility.spec.ts only ever opens the public build; locally it saves two extra builds.
const appServerOnly = process.env.QA_APP_SERVER_ONLY === 'true';
// Request-only specs (no browser): live API health and the signed-in live smoke.
const apiSpecs = /(api-health|live-account-smoke)\.spec\.ts/;
// Admin site specs (tests/e2e/admin-*.spec.ts) run against the admin build (VITE_APP_TARGET=admin).
const adminSpecs = /[\\/]admin-[^\\/]*\.spec\.ts$/;
const adminSiteUrl = localOrigin(3);
// Mocked-API runs only: live and integration runs have no admin build to open.
const adminSiteRun = !liveBaseUrl && !integrationRun && !appServerOnly;
// Device matrix for the accessibility gate (tests/e2e/accessibility.spec.ts) only: the narrowest phone
// the layout supports (iPhone SE, 320 px) and a current Android phone. Playwright's iPhone SE
// descriptor defaults to WebKit, which CI does not install, so it runs in Chromium here; the
// viewport, scale factor, touch and mobile emulation are what the sweep is after.
// They repeat the route sweep (tests tagged @sweep) only; the dialog, form and interaction checks in that
// spec run on chromium-desktop and chromium-mobile as before.
const accessibilitySpec = /[\\/]accessibility\.spec\.ts$/;
const deviceProjects = [
  {
    name: 'iphone-se',
    testMatch: accessibilitySpec,
    grep: /@sweep/,
    use: { ...devices['iPhone SE'], defaultBrowserType: 'chromium' as const },
  },
  {
    name: 'pixel-7',
    testMatch: accessibilitySpec,
    grep: /@sweep/,
    use: { ...devices['Pixel 7'] },
  },
];

const browserProjects = [
  {
    name: 'chromium-desktop',
    testIgnore: [apiSpecs, adminSpecs],
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'chromium-mobile',
    testIgnore: [apiSpecs, adminSpecs],
    use: { ...devices['Pixel 7'] },
  },
  ...(fullMatrix
    ? [
        {
          name: 'firefox-desktop',
          testIgnore: [apiSpecs, adminSpecs],
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'webkit-mobile',
          testIgnore: [apiSpecs, adminSpecs],
          use: { ...devices['iPhone 15'] },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/qa-results.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: liveBaseUrl || appUrl,
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'api',
      testMatch: apiSpecs,
      use: {},
    },
    ...browserProjects,
    ...deviceProjects,
    ...(adminSiteRun
      ? [
          {
            name: 'admin-desktop',
            testMatch: adminSpecs,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: adminSiteUrl },
          },
        ]
      : []),
  ],
  webServer: liveBaseUrl
    ? undefined
    : [
        {
          command: `npm run build && npm exec vite preview -- --host 127.0.0.1 --strictPort --port ${portBase}`,
          // The mocked suite exercises the launch-switched surfaces too, so build with them on.
          env: { ...process.env, VITE_FEATURE_STAGE: 'true', VITE_FEATURE_RESUMES: 'true' },
          url: appUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        // error-monitoring.spec.ts only (skipped in integration runs): a local stand-in for
        // Sentry's ingest endpoint, and the app built with a fake DSN pointing at it.
        ...(integrationRun || appServerOnly
          ? []
          : [
              {
                command: `node tests/e2e/support/sentry-sink.mjs ${portBase + 2}`,
                url: sentrySinkUrl,
                reuseExistingServer: !process.env.CI,
                timeout: 30_000,
              },
              {
                command: `npm exec vite build -- --outDir dist-qa-sentry && npm exec vite preview -- --outDir dist-qa-sentry --host 127.0.0.1 --strictPort --port ${portBase + 1}`,
                url: sentryBuildUrl,
                env: {
                  VITE_SENTRY_DSN: `http://qapublickey@127.0.0.1:${portBase + 2}/1`,
                  VITE_SENTRY_ENVIRONMENT: 'qa',
                  VITE_RELEASE: 'qa-sentry-build',
                },
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
              // The separate admin site: its own build with only the admin routes.
              {
                command: `npm exec vite build -- --outDir dist-qa-admin && npm exec vite preview -- --outDir dist-qa-admin --host 127.0.0.1 --strictPort --port ${portBase + 3}`,
                url: adminSiteUrl,
                // No public routes exist in this build, so entityLink (shared.tsx) needs the public
                // site's own origin to link to a listing/profile/act absolutely.
                env: { VITE_APP_TARGET: 'admin', VITE_PUBLIC_URL: appUrl },
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
            ]),
      ],
});
