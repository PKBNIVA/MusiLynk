import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-*',
      'node_modules',
      'backend',
      'playwright-report',
      'test-results',
      'coverage',
      '.qa-stack',
      '*.local.config.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Pages still read untyped JSON through apiGet<any>; the shared data layer below is any-free.
      '@typescript-eslint/no-explicit-any': 'off',
      // `a ? doThis() : doThat()` as a statement is an existing idiom in the pages.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // The shared data layer (API client, auth, monitoring, payments) is fully typed; keep it that way.
    files: ['src/app/lib/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // `catch {}` marks deliberately ignored failures (blocked storage, optional parsing).
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['tests/**/*.{ts,mjs}', 'scripts/**/*.{js,mjs}', '*.config.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
);
