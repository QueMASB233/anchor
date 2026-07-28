import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // GitHub Actions runs the committed dist/ directly with no install step,
  // so every dependency must be bundled in.
  noExternal: [/.*/],
  dts: false,
  sourcemap: false,
  clean: true,
  minify: false,
  target: 'node20',
  platform: 'node',
});
