/**
 * AGENTS.md — the cross-tool convention, read by Codex among others.
 *
 * Unlike CLAUDE.md, AGENTS.md is usually the whole file rather than one section
 * of a larger document, so this generator emits a complete document with a
 * top-level heading.
 */

import type { DesignSystem } from '../model/index.js';
import { buildSections, type GeneratorOptions } from './document.js';
import { MARKDOWN_MARKERS, mergeManagedBlock, type MergeResult } from './managed-block.js';

export function generateAgentsMd(system: DesignSystem, options: GeneratorOptions = {}): string {
  const { sections, summary } = buildSections(system, options);

  const parts = [
    '# Design system',
    '',
    summary,
    '',
    '## How to use this document',
    '',
    '- Use the token names below verbatim. They are the vocabulary of this codebase.',
    '- Never introduce a value that is not listed here. If nothing fits, say so rather than inventing one.',
    '- The rules at the end are enforced automatically; breaking one will block the pull request.',
  ];

  for (const section of sections) {
    parts.push('', `## ${section.title}`, '', section.body);
  }

  return `${parts.join('\n')}\n`;
}

export function syncAgentsMd(
  system: DesignSystem,
  existing: string | null,
  options: GeneratorOptions = {},
): MergeResult {
  return mergeManagedBlock(existing, generateAgentsMd(system, options), MARKDOWN_MARKERS);
}
