/**
 * The compiled entry GitHub executes.
 *
 * Split from index.ts so the module can be imported by tests without running a
 * whole lint pass as an import side effect.
 *
 * Deliberately not top-level `await`: this file is bundled to CommonJS, where
 * top-level await does not exist. See tsup.config.ts for why CJS.
 */

import { main } from './index.js';

void main().catch((cause: unknown) => {
  process.stderr.write(`Anchor action failed to start: ${String(cause)}\n`);
  process.exitCode = 1;
});
