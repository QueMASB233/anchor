import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/tests/fixtures/**',
      'packages/action/dist/**',
      // Build-time codegen scripts, outside any package tsconfig.
      '**/scripts/**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Anchor never executes code from the repo under test. These are the
      // primitives that would make that possible, so they are hard errors.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',

      // Correctness guards that matter for a CLI doing lots of async file I/O.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      // A `default` case counts as exhaustive. Anchor switches over ESTree's
      // ~180-member node type union; enumerating every arm would be noise.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],

      // `any` is allowed only with an explicit justification comment, per spec.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Config files are not part of any package's tsconfig include.
    files: ['*.config.ts', '*.config.js', '**/*.config.ts', 'vitest.workspace.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
