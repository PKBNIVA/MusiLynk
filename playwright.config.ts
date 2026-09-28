import { defineConfig, devices } from '@playwright/test';

const liveBaseUrl = process.env.QA_BASE_URL?.replace(/\/$/, '');
const fullMatrix = process.env.QA_FULL_MATRIX === 'true';
const integrationRun = process.env.QA_INTEGRATION === 'true';
// Request-only specs (no browser): live API health and the signed-in live smoke.
const apiSpecs = /(api-health|live-account-smoke)\.spec\.ts/;
// Admin site specs (tests/e2e/admin-*.spec.ts) run against the admin build (VITE_APP_TARGET=admin).
const adminSpecs = /[\\/]admin-[^\\/]*\.spec\.ts$/;
const adminSiteUrl = 'http://127.0.0.1:4176';
// Mocked-API runs only: live and integration runs have no admin build to open.
const adminSiteRun = !liveBaseUrl && !integrationRun;

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
    baseURL: liveBaseUrl || 'http://127.0.0.1:4173',
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
          command: 'npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4173',
          // The mocked suite exercises the launch-switched surfaces too, so build with them on.
          env: { ...process.env, VITE_FEATURE_STAGE: 'true', VITE_FEATURE_RESUMES: 'true' },
          url: 'http://127.0.0.1:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        // error-monitoring.spec.ts only (skipped in integration runs): a local stand-in for
        // Sentry's ingest endpoint, and the app built with a fake DSN pointing at it.
        ...(integrationRun
          ? []
          : [
              {
                command: 'node tests/e2e/support/sentry-sink.mjs 4175',
                url: 'http://127.0.0.1:4175',
                reuseExistingServer: !process.env.CI,
                timeout: 30_000,
              },
              {
                command:
                  'npm exec vite build -- --outDir dist-qa-sentry && npm exec vite preview -- --outDir dist-qa-sentry --host 127.0.0.1 --port 4174',
                url: 'http://127.0.0.1:4174',
                env: {
                  VITE_SENTRY_DSN: 'http://qapublickey@127.0.0.1:4175/1',
                  VITE_SENTRY_ENVIRONMENT: 'qa',
                  VITE_RELEASE: 'qa-sentry-build',
                },
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
              // The separate admin site: its own build with only the admin routes.
              {
                command:
                  'npm exec vite build -- --outDir dist-qa-admin && npm exec vite preview -- --outDir dist-qa-admin --host 127.0.0.1 --port 4176',
                url: adminSiteUrl,
                // No public routes exist in this build, so entityLink (shared.tsx) needs the public
                // site's own origin to link to a listing/profile/act absolutely.
                env: { VITE_APP_TARGET: 'admin', VITE_PUBLIC_URL: 'http://127.0.0.1:4173' },
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
            ]),
      ],
});
