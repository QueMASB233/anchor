/**
 * Context file generators.
 *
 * Turn a normalized design system into the files AI coding agents read, so an
 * agent writes on-system code from the first attempt rather than being
 * corrected afterwards by the linter.
 *
 * Every generator is deterministic: the same design system produces the same
 * bytes. These files are committed, and output that churned on every run would
 * quickly be ignored.
 */

import type { DesignSystem } from '../model/index.js';
import { generateAgentsMd, syncAgentsMd } from './agents-md.js';
import { generateClaudeMd, syncClaudeMd } from './claude-md.js';
import { generateCursorrules, syncCursorrules } from './cursorrules.js';
import type { GeneratorOptions } from './document.js';
import type { BlockMarkers, MergeResult } from './managed-block.js';
import { MARKDOWN_MARKERS, TEXT_MARKERS } from './managed-block.js';

export * from './agents-md.js';
export * from './claude-md.js';
export * from './cursorrules.js';
export * from './document.js';
export * from './managed-block.js';

/** The context files Anchor can generate. */
export type GeneratorTarget = 'claude-md' | 'cursorrules' | 'agents-md';

export interface GeneratorDefinition {
  target: GeneratorTarget;
  /** Conventional path, relative to the project root. */
  defaultPath: string;
  displayName: string;
  markers: BlockMarkers;
  generate(system: DesignSystem, options?: GeneratorOptions): string;
  sync(system: DesignSystem, existing: string | null, options?: GeneratorOptions): MergeResult;
}

export const GENERATORS: readonly GeneratorDefinition[] = [
  {
    target: 'claude-md',
    defaultPath: 'CLAUDE.md',
    displayName: 'Claude Code',
    markers: MARKDOWN_MARKERS,
    generate: generateClaudeMd,
    sync: syncClaudeMd,
  },
  {
    target: 'cursorrules',
    defaultPath: '.cursorrules',
    displayName: 'Cursor',
    markers: TEXT_MARKERS,
    generate: generateCursorrules,
    sync: syncCursorrules,
  },
  {
    target: 'agents-md',
    defaultPath: 'AGENTS.md',
    displayName: 'AGENTS.md',
    markers: MARKDOWN_MARKERS,
    generate: generateAgentsMd,
    sync: syncAgentsMd,
  },
];

/** Looks up a generator by target, for the CLI's `--only` flag. */
export function getGenerator(target: GeneratorTarget): GeneratorDefinition {
  const generator = GENERATORS.find((candidate) => candidate.target === target);
  if (generator === undefined) {
    throw new Error(`Unknown generator target: ${target}`);
  }
  return generator;
}
