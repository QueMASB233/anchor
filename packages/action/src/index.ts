/**
 * Anchor's GitHub Action entry point.
 *
 * SECURITY: everything reachable from here runs against pull request contents,
 * which are attacker-controlled. This entry point must never import, evaluate,
 * or execute code from the repository under test, and must never enable the
 * `resolveConfig` escape hatch. Files are read as text and parsed to an AST.
 *
 * See run.ts for how each of those is enforced rather than assumed.
 */

import { error } from './inputs.js';
import { run } from './run.js';

export { run, hardenConfig, ACTION_VERSION } from './run.js';
export * from './github-api.js';
export * from './inputs.js';

/** Runs the action, converting any unexpected failure into a clean job error. */
export async function main(): Promise<void> {
  try {
    const result = await run();
    process.exitCode = result.exitCode;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    error(`Anchor could not complete this run: ${message}`);
    // Exit 1 rather than 2: from a workflow's point of view the step failed,
    // and a distinct code here would only complicate `continue-on-error`.
    process.exitCode = 1;
  }
}
