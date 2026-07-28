/**
 * Token parsers.
 *
 * Every parser normalizes to the same `DesignSystem`, so adding a format never
 * touches rule, generator or reporter code. Parsers are pure, synchronous, and
 * receive file contents as text — they never read from disk and never execute
 * the project they are reading.
 */

export * from './build-tokens.js';
export * from './css-variables.js';
export * from './detect.js';
export * from './figma-variables.js';
export * from './static-eval.js';
export * from './style-dictionary.js';
export * from './tailwind/index.js';
export * from './token-tree.js';
export * from './types.js';
export * from './w3c-dtcg.js';
