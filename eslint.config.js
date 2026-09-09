import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // The interface, copied into the publishable package at build time.
      'packages/cli/ui/**',
      // The staged package: build output, assembled for `npm pack`.
      'packages/cli/package/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.wrangler/**',
      // Astro's generated content and route types. Regenerated on every build,
      // never edited, and not ours to hold to a style rule.
      '**/.astro/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Use the storage helper so SSR/tests stay safe.' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // The recorder extension runs in a Chrome MV3 context.
    files: ['apps/extension/**/*.{js,ts}'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  prettier,
);
