import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entries: the library surface, and the executable that calls into it.
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  banner: { js: '#!/usr/bin/env node' },
});
