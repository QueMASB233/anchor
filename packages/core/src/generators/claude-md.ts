/**
 * CLAUDE.md — context for Claude Code.
 *
 * Claude Code loads this file on every request, so it is written as direct
 * instruction rather than documentation: what to do, what never to do, and the
 * exact vocabulary to use.
 */

import type { DesignSystem } from '../model/index.js';
import { buildSections, type GeneratorOptions } from './document.js';
import { MARKDOWN_MARKERS, mergeManagedBlock, type MergeResult } from './managed-block.js';

/** Renders the design system as the body of a CLAUDE.md section. */
export function generateClaudeMd(system: DesignSystem, options: GeneratorOptions = {}): string {
  const { sections, summary } = buildSections(system, options);

  const parts = [
    '## Design system',
    '',
    summary,
    '',
    'If a value you need is not in this document, do not invent one — ask, or use the closest token listed.',
  ];

  for (const section of sections) {
    parts.push('', `### ${section.title}`, '', section.body);
  }

  return `${parts.join('\n')}\n`;
}

/**
 * Merges the generated design system section into an existing CLAUDE.md,
 * preserving everything the team wrote outside Anchor's markers.
 */
export function syncClaudeMd(
  system: DesignSystem,
  existing: string | null,
  options: GeneratorOptions = {},
): MergeResult {
  return mergeManagedBlock(existing, generateClaudeMd(system, options), MARKDOWN_MARKERS);
}
