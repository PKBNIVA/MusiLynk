import { defineConfig } from 'vitest/config';

// Unit tests for the shared frontend logic in src/app/lib (npm run test:unit).
// Browser journeys stay in Playwright (tests/e2e); these run in jsdom in seconds.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/app/lib/**/*.{ts,tsx}'],
      exclude: ['src/app/lib/__tests__/**'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // A few points under the measured figure (100% lines, 99.4% statements, 99.2%
      // functions, 95.6% branches) so coverage cannot quietly slide. `npm run test:unit --
      // --coverage` (as CI runs it) fails below these; raise them as coverage goes up.
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
