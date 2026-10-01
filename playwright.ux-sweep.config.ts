import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Config for the on-demand UX sweep (tests/e2e/zz-ux-sweep.spec.ts): the normal config with no web
// servers (the sweep runs against the local production-mode stack), one browser project, and no
// traces, videos or failure screenshots, which would otherwise fill the disk during a long run.
export default defineConfig({
  ...base,
  webServer: undefined,
  reporter: [['list']],
  fullyParallel: true,
  testMatch: /zz-ux-sweep\.spec\.ts$/,
  use: {
    ...base.use,
    baseURL: process.env.UX_WEB_URL || 'http://127.0.0.1:4600',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: (base.projects ?? []).filter((project) => project.name === 'chromium-desktop'),
});
