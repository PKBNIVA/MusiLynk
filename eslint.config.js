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
      // API responses are typed in src/app/lib/apiTypes.ts; catch blocks take `unknown` (see lib/errors.ts).
      '@typescript-eslint/no-explicit-any': 'error',
      // `a ? doThis() : doThat()` as a statement is an existing idiom in the pages.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
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
