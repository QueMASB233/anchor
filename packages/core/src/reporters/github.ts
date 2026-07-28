/**
 * GitHub Actions output: inline annotations and a pull request comment.
 *
 * SECURITY — WORKFLOW COMMAND INJECTION
 * -------------------------------------
 * Annotations are emitted as workflow commands, which the runner parses out of
 * stdout as plain text:
 *
 *   ::error file=App.tsx,line=3,col=5::Message here
 *
 * Anchor's messages quote content from the file being linted — class names,
 * prop values, colour literals — and in CI that file comes from a pull request
 * written by anyone. An unescaped newline in that content would let a
 * contributor close the command and start a new one, and workflow commands can
 * set environment variables and step outputs that later steps trust.
 *
 * So every value is escaped per GitHub's documented rules before it is
 * printed: `%`, CR and LF everywhere, plus `:` and `,` inside properties where
 * they are structural. This is the security boundary of this file, and the
 * tests treat it as one.
 */

import type { Violation } from '../engine/violation.js';
import type { LintReport, Reporter, ReporterOptions } from './types.js';

/** GitHub rejects comments beyond this, so output is truncated to fit. */
const MAX_COMMENT_LENGTH = 65_000;

/** Violations listed per file before the rest are summarized. */
const MAX_ROWS_PER_FILE = 20;

/** Marker so the Action can find and update its own previous comment. */
export const COMMENT_MARKER = '<!-- anchor-lint-report -->';

/**
 * Escapes a workflow command's *message* payload.
 *
 * `%` first, or it would double-escape the sequences introduced afterwards.
 */
export function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Escapes a workflow command *property* value.
 *
 * Properties are delimited by `,` and `=` and terminated by `::`, so a colon
 * or comma in a value would corrupt the command's structure.
 */
export function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Renders one `::error` / `::warning` annotation. */
export function annotationFor(violation: Violation, cwd?: string): string {
  const command = violation.severity === 'error' ? 'error' : 'warning';
  const file = relativePath(violation.file, cwd);

  const properties = [
    `file=${escapeProperty(file)}`,
    `line=${violation.line}`,
    `col=${violation.column}`,
    `endLine=${violation.endLine}`,
    `endColumn=${violation.endColumn}`,
    `title=${escapeProperty(`Anchor: ${violation.ruleId}`)}`,
  ].join(',');

  return `::${command} ${properties}::${escapeData(violation.message)}`;
}

function relativePath(path: string, cwd: string | undefined): string {
  if (cwd === undefined) return path;
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Makes text safe to drop into a Markdown table cell.
 *
 * GitHub sanitizes HTML in comments, so this is about output integrity rather
 * than script injection: an unescaped `|` would split a row into extra columns
 * and a newline would end the table early, either of which lets a crafted
 * class name make the report unreadable or hide rows beneath it.
 */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Every annotation, one per line, ready to print to stdout. */
export function renderAnnotations(report: LintReport, options: ReporterOptions = {}): string {
  return report.violations.map((violation) => annotationFor(violation, options.cwd)).join('\n');
}

/** The pull request comment body. */
export function renderComment(report: LintReport, options: ReporterOptions = {}): string {
  const { errors, warnings, total, fixable } = report.counts;
  const lines: string[] = [COMMENT_MARKER, ''];

  if (total === 0) {
    lines.push(
      '### Anchor — design system check passed',
      '',
      `No violations in ${report.filesChecked} ${report.filesChecked === 1 ? 'file' : 'files'}.`,
    );
    return `${lines.join('\n')}\n`;
  }

  const headline = [
    errors > 0 ? `**${errors}** ${errors === 1 ? 'error' : 'errors'}` : null,
    warnings > 0 ? `**${warnings}** ${warnings === 1 ? 'warning' : 'warnings'}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' and ');

  lines.push(
    '### Anchor — design system violations',
    '',
    `${headline} across ${report.filesWithViolations} ${report.filesWithViolations === 1 ? 'file' : 'files'}.`,
    '',
  );

  for (const file of report.files) {
    if (file.violations.length === 0) continue;

    const path = relativePath(file.path, options.cwd);
    lines.push(
      `#### \`${escapeMarkdownCell(path)}\``,
      '',
      '| Line | Rule | Issue |',
      '| --- | --- | --- |',
    );

    for (const violation of file.violations.slice(0, MAX_ROWS_PER_FILE)) {
      const marker = violation.severity === 'error' ? '🔴' : '🟡';
      lines.push(
        `| ${violation.line}:${violation.column} | ${marker} \`${escapeMarkdownCell(violation.ruleId)}\` | ${escapeMarkdownCell(violation.message)} |`,
      );
    }

    if (file.violations.length > MAX_ROWS_PER_FILE) {
      lines.push(`\n… and ${file.violations.length - MAX_ROWS_PER_FILE} more in this file.\n`);
    }

    lines.push('');
  }

  if (fixable > 0) {
    lines.push(
      `${fixable} of these can be fixed automatically:`,
      '',
      '```bash',
      'npx @eleva/anchor lint --fix',
      '```',
      '',
    );
  }

  lines.push(
    '<sub>Checked locally by [Anchor](https://github.com/eleva-builds/anchor). No code left this runner. Suppress a line with `// anchor-disable-next-line <rule>`.</sub>',
  );

  const body = `${lines.join('\n')}\n`;
  if (body.length <= MAX_COMMENT_LENGTH) return body;

  // Truncate on a line boundary so the Markdown never ends mid-table.
  const truncated = body.slice(0, MAX_COMMENT_LENGTH - 200);
  const lastNewline = truncated.lastIndexOf('\n');
  return `${truncated.slice(0, lastNewline)}\n\n<sub>Report truncated: too many violations to display. Run \`anchor lint\` locally for the full list.</sub>\n`;
}

/**
 * Annotations followed by the comment body, separated by a marker the Action
 * splits on. Annotations go to stdout; the body is posted to the pull request.
 */
export const githubReporter: Reporter = {
  format: 'github',

  render(report: LintReport, options: ReporterOptions = {}): string {
    const annotations = renderAnnotations(report, options);
    return annotations === '' ? '' : `${annotations}\n`;
  },
};
