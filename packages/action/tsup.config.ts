import { defineConfig } from 'tsup';

/**
 * Shim for `import.meta.url` inside a CommonJS bundle.
 *
 * Several bundled dependencies call `createRequire(import.meta.url)` at load
 * time. Compiled to CJS that expression is `undefined`, and `createRequire`
 * throws before the action reaches its first line. Defining it to a real file
 * URL derived from `__filename` restores the behaviour those packages expect.
 */
const IMPORT_META_URL_SHIM = `
const { pathToFileURL: __anchorPathToFileURL } = require('node:url');
const __anchorImportMetaUrl = __anchorPathToFileURL(__filename).href;
`;

export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  /**
   * CommonJS, deliberately.
   *
   * GitHub runs this bundle with no install step, so every dependency is
   * inlined — and several of them (typescript, debug) call `require()` on Node
   * builtins at load time. Bundled into ESM those become `__require` shims that
   * throw "Dynamic require of 'tty' is not supported", breaking the action on
   * every run. CJS output makes `require` native again. This is why the Actions
   * ecosystem standardised on ncc's CJS bundles.
   */
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  noExternal: [/.*/],
  dts: false,
  sourcemap: false,
  clean: true,
  // Minified to keep the committed bundle from bloating git history: this file
  // is regenerated on every action change. Auditing happens against src/, and
  // CI verifies the committed bundle matches it byte for byte.
  minify: true,
  target: 'node20',
  platform: 'node',
  // One file: GitHub only knows about `main`.
  splitting: false,
  banner: { js: IMPORT_META_URL_SHIM },
  define: {
    'import.meta.url': '__anchorImportMetaUrl',
    'import.meta.dirname': '__dirname',
    'import.meta.filename': '__filename',
  },
});
