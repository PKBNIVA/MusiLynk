// Auth hydration and navigation unread-count behaviour are asserted by Vitest; this keeps the
// `npm run test:frontend-bootstrap` entry point and runs those tests.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx',
  ['vitest', 'run', 'src/app/lib/__tests__/authContext.test.tsx', 'src/app/components/__tests__/Navigation.test.tsx'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
