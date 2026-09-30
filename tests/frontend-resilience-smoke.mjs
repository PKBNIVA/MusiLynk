// Loading, error and retry states of the app and public pages are asserted by Vitest; this keeps the
// `npm run test:frontend-resilience` entry point and runs those tests.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    'src/app/pages/__tests__/appResilience.test.tsx',
    'src/app/pages/public/__tests__/publicResilience.test.tsx',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
