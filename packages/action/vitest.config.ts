import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'action',
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
