import js from '@eslint/js';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // scripts/ lives outside the build's tsconfig include, so it needs its
        // own project for typed linting to resolve it.
        project: ['./tsconfig.json', './tsconfig.scripts.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // Warnings get ignored in CI; errors block the merge. Everything is an error.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': 'off', // superseded by unused-imports
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The structured logger is the only sanctioned output: console is never
      // redacted, never structured, never machine-parseable.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Scripts run outside the server process and print to a human's terminal.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
