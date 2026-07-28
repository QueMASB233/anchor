/**
 * Anchor's GitHub Action entry point.
 *
 * SECURITY: everything reachable from here runs against pull request contents,
 * which are attacker-controlled. This entry point must never import, evaluate,
 * or execute code from the repository under test, and must never enable the
 * `resolveConfig` escape hatch. Files are read as text and parsed to an AST.
 */

export const ACTION_VERSION = '0.0.0';

export {};
