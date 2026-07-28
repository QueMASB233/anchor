import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

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
  // Baked in at build time so the reported version cannot drift from what
  // shipped, and so nothing has to read a file at runtime.
  define: { __ANCHOR_VERSION__: JSON.stringify(version) },
});
