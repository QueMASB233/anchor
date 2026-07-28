/**
 * Machine-readable output.
 *
 * The shape is a published interface: scripts and dashboards will depend on
 * it, so it carries an explicit `schemaVersion` and changes to it are breaking
 * changes like any other.
 *
 * Byte offsets from `fix` are deliberately omitted — they are meaningless
 * outside the exact file revision Anchor read, and exporting them invites
 * consumers to apply edits against a file that has since changed.
 */

import type { LintReport, Reporter, ReporterOptions } from './types.js';

/** Bumped when the JSON output shape changes incompatibly. */
export const JSON_SCHEMA_VERSION = 1;

export const jsonReporter: Reporter = {
  format: 'json',

  render(report: LintReport, options: ReporterOptions = {}): string {
    const payload = {
      schemaVersion: JSON_SCHEMA_VERSION,
      ...(options.version === undefined ? {} : { anchorVersion: options.version }),
      ...(report.designSystem === undefined ? {} : { designSystem: report.designSystem }),
      summary: {
        filesChecked: report.filesChecked,
        filesWithViolations: report.filesWithViolations,
        errors: report.counts.errors,
        warnings: report.counts.warnings,
        total: report.counts.total,
        fixable: report.counts.fixable,
        ...(report.durationMs === undefined ? {} : { durationMs: report.durationMs }),
      },
      files: report.files.map((file) => ({
        path: file.path,
        ...(file.parseError === undefined ? {} : { parseError: file.parseError }),
        violations: file.violations.map((violation) => ({
          ruleId: violation.ruleId,
          severity: violation.severity,
          message: violation.message,
          line: violation.line,
          column: violation.column,
          endLine: violation.endLine,
          endColumn: violation.endColumn,
          ...(violation.suggestedFix === undefined ? {} : { suggestedFix: violation.suggestedFix }),
          fixable: violation.fix !== undefined,
        })),
      })),
    };

    return `${JSON.stringify(payload, null, 2)}\n`;
  },
};
