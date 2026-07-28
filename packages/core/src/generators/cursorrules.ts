/**
 * .cursorrules — context for Cursor.
 *
 * Cursor treats this as a plain instruction list rather than a document, and
 * historically truncates aggressively, so this renderer is the terse one:
 * imperative voice, no tables, rules first.
 *
 * Putting the rules before the token reference is the deliberate difference
 * from the Markdown generators. If only the opening survives truncation, the
 * prohibitions are what we most want to have made it through.
 */

import type { DesignSystem } from '../model/index.js';
import { buildSections, type GeneratorOptions } from './document.js';
import { mergeManagedBlock, TEXT_MARKERS, type MergeResult } from './managed-block.js';

/** Strips Markdown table syntax, which Cursor renders as noise. */
function flattenTables(body: string): string {
  const lines = body.split('\n').filter((line) => !/^\s*\|\s*-{2,}/.test(line));

  return lines
    .map((line) => {
      if (!line.trimStart().startsWith('|')) return line;
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '');
      return `- ${cells.join(' — ')}`;
    })
    .join('\n')
    .replace(/<br>/g, '; ');
}

export function generateCursorrules(system: DesignSystem, options: GeneratorOptions = {}): string {
  const { sections, summary } = buildSections(system, options);

  const rules = sections.find((section) => section.title === 'Rules');
  const rest = sections.filter((section) => section.title !== 'Rules');

  const parts = [summary.replace(/\*\*/g, ''), ''];

  if (rules !== undefined) {
    parts.push(
      'HARD RULES — these are enforced on every pull request:',
      '',
      flattenTables(rules.body),
      '',
    );
  }

  parts.push('Design system reference:');

  for (const section of rest) {
    parts.push('', `${section.title}:`, flattenTables(section.body));
  }

  parts.push(
    '',
    'If a value you need is not listed above, do not invent one. Use the closest token, or ask.',
  );

  return `${parts.join('\n')}\n`;
}

export function syncCursorrules(
  system: DesignSystem,
  existing: string | null,
  options: GeneratorOptions = {},
): MergeResult {
  return mergeManagedBlock(existing, generateCursorrules(system, options), TEXT_MARKERS);
}
