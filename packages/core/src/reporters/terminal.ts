/**
 * Human-readable output for a developer's terminal.
 *
 * ANSI codes are hand-written rather than pulled from a dependency: it is
 * twenty lines, and Anchor's install size is part of its pitch.
 *
 * Colour is never auto-detected here. The caller passes `color`, so the same
 * report renders identically in a test, a pipe and a CI log.
 */

import type { Violation } from '../engine/violation.js';
import type { LintReport, Reporter, ReporterOptions } from './types.js';

const ANSI = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  green: '\u001B[32m',
  cyan: '\u001B[36m',
  grey: '\u001B[90m',
} as const;

type Style = keyof typeof ANSI;

function paint(text: string, style: Style, enabled: boolean): string {
  return enabled ? `${ANSI[style]}${text}${ANSI.reset}` : text;
}

/** Shortens an absolute path against the working directory. */
function displayPath(path: string, cwd: string | undefined): string {
  if (cwd === undefined) return path;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Renders the offending line with a caret underneath.
 *
 * Worth the effort: a violation you can see is a violation you fix now, rather
 * than one you go hunting for and then postpone.
 */
function codeFrame(violation: Violation, source: string, color: boolean): string[] {
  const lines = source.split('\n');
  const line = lines[violation.line - 1];
  if (line === undefined) return [];

  const gutter = String(violation.line);
  const pad = ' '.repeat(gutter.length);
  const width = Math.max(1, violation.endColumn - violation.column);
  const caretColor = violation.severity === 'error' ? 'red' : 'yellow';

  return [
    `  ${paint(`${gutter} |`, 'grey', color)} ${line}`,
    `  ${paint(`${pad} |`, 'grey', color)} ${' '.repeat(violation.column - 1)}${paint(
      '^'.repeat(width),
      caretColor,
      color,
    )}`,
  ];
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const terminalReporter: Reporter = {
  format: 'terminal',

  render(report: LintReport, options: ReporterOptions = {}): string {
    const color = options.color ?? false;
    const emoji = options.emoji ?? false;
    const lines: string[] = [];

    for (const file of report.files) {
      if (file.parseError !== undefined) {
        lines.push(
          paint(displayPath(file.path, options.cwd), 'bold', color),
          `  ${paint('parse error', 'red', color)}  ${file.parseError.message}`,
          '',
        );
        continue;
      }

      if (file.violations.length === 0) continue;

      lines.push(paint(displayPath(file.path, options.cwd), 'bold', color));

      const source = options.getSource?.(file.path);

      for (const violation of file.violations) {
        const label = violation.severity === 'error' ? 'error  ' : 'warning';
        const marked = emoji ? `${violation.severity === 'error' ? '✖' : '▲'} ${label}` : label;
        const severity =
          violation.severity === 'error'
            ? paint(marked, 'red', color)
            : paint(marked, 'yellow', color);

        const position = paint(`${violation.line}:${violation.column}`, 'dim', color);
        const rule = paint(violation.ruleId, 'grey', color);

        lines.push(`  ${position}  ${severity}  ${violation.message}  ${rule}`);

        if (source !== undefined) lines.push(...codeFrame(violation, source, color));

        if (violation.fix !== undefined) {
          lines.push(`  ${paint('fixable with --fix', 'green', color)}`);
        }
      }

      lines.push('');
    }

    const { errors, warnings, total, fixable } = report.counts;

    if (options.summary === false) {
      return lines.length === 0 ? '' : `${lines.join('\n').trimEnd()}\n`;
    }

    if (total === 0) {
      const checked = pluralize(report.filesChecked, 'file');
      lines.push(paint(`No design system violations in ${checked}.`, 'green', color));
      return `${lines.join('\n')}\n`;
    }

    const parts: string[] = [];
    if (errors > 0) parts.push(paint(pluralize(errors, 'error'), 'red', color));
    if (warnings > 0) parts.push(paint(pluralize(warnings, 'warning'), 'yellow', color));

    lines.push(
      `${paint(String(total), 'bold', color)} ${total === 1 ? 'violation' : 'violations'} (${parts.join(', ')}) in ${pluralize(report.filesWithViolations, 'file')}.`,
    );

    if (fixable > 0) {
      lines.push(
        paint(
          `${fixable} of them can be fixed automatically — run \`anchor lint --fix\`.`,
          'cyan',
          color,
        ),
      );
    }

    return `${lines.join('\n')}\n`;
  },
};
