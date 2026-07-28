/**
 * The `anchor` executable.
 *
 * Kept separate from index.ts so importing the CLI as a library never runs a
 * command as a side effect — which is what makes the end-to-end tests able to
 * drive `runLint` directly instead of spawning a process for every case.
 *
 * Avoids top-level await so this module stays bundleable into CommonJS, which
 * the GitHub Action needs.
 */

import { main } from './index.js';

void main().catch((cause: unknown) => {
  process.stderr.write(`anchor: ${String(cause)}\n`);
  process.exitCode = 2;
});
