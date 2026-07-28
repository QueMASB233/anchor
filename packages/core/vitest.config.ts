import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      // The rule engine and parsers are the correctness-critical surface.
      // Raised progressively as each package lands; see CONTRIBUTING.md.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
