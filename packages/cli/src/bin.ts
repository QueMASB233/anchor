/**
 * The `anchor` executable.
 *
 * Kept separate from index.ts so importing the CLI as a library never runs a
 * command as a side effect — which is what makes the end-to-end tests able to
 * drive `runLint` directly instead of spawning a process for every case.
 */

import { main } from './index.js';

await main();
