import { defineConfig, type Plugin } from 'vitest/config';

// Vitest resolves `import.meta.env` by rewriting that exact text before TypeScript is
// stripped, so the `(import.meta as any).env` spelling used in src/app/lib would read
// nothing and vi.stubEnv() could not reach it. The production build is unaffected; this
// test-only rewrite lets the unit tests exercise the real env handling.
function importMetaEnvForTests(): Plugin {
  return {
    name: 'verse-test-import-meta-env',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/src\/.*\.tsx?$/.test(id) || !code.includes('(import.meta as any).env')) return null;
      // Padded to the same length so line and column positions (and coverage) stay exact.
      const replacement = 'import.meta.env'.padEnd('(import.meta as any).env'.length, ' ');
      return { code: code.replaceAll('(import.meta as any).env', replacement), map: null };
    },
  };
}

// Unit tests for the shared frontend logic in src/app/lib (npm run test:unit).
// Browser journeys stay in Playwright (tests/e2e); these run in jsdom in seconds.
export default defineConfig({
  plugins: [importMetaEnvForTests()],
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
