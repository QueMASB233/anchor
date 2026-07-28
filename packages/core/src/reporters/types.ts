/**
 * The shape reporters format, and the contract they share.
 *
 * Reporters are pure string producers: they never write files, never touch
 * stdout, and never read the environment. The CLI decides where output goes,
 * which keeps every reporter trivially testable and keeps I/O in one layer.
 */

import type { LintFileResult } from '../engine/linter.js';
import {
  compareViolations,
  countViolations,
  type Violation,
  type ViolationCounts,
} from '../engine/violation.js';

export interface FileReport {
  path: string;
  violations: Violation[];
  /** Set when the file could not be parsed at all. */
  parseError?: { message: string; line?: number; column?: number };
}

export interface LintReport {
  files: FileReport[];
  /** Every violation across every file, in stable order. */
  violations: Violation[];
  counts: ViolationCounts;
  filesChecked: number;
  /** Files that produced at least one violation. */
  filesWithViolations: number;
  designSystem?: { name: string; source: string };
  durationMs?: number;
}

export interface ReporterOptions {
  /** Emit ANSI colour. Callers decide; reporters never sniff the terminal. */
  color?: boolean;
  /** Resolves a file's source text, enabling code frames. */
  getSource?: (path: string) => string | undefined;
  /** Root used to shorten displayed paths. */
  cwd?: string;
  /** Version of Anchor, recorded in machine-readable output. */
  version?: string;
}

export type ReporterFormat = 'terminal' | 'json' | 'sarif' | 'github';

export interface Reporter {
  readonly format: ReporterFormat;
  /** Renders the whole report. Returns text; writing it is the caller's job. */
  render(report: LintReport, options?: ReporterOptions): string;
}

export interface BuildReportInput {
  results: readonly LintFileResult[];
  designSystem?: { name: string; source: string };
  durationMs?: number;
}

/** Aggregates per-file results into the report every reporter consumes. */
export function buildReport(input: BuildReportInput): LintReport {
  const files: FileReport[] = input.results.map((result) => ({
    path: result.file,
    violations: [...result.violations].sort(compareViolations),
    ...(result.parseError === undefined ? {} : { parseError: result.parseError }),
  }));

  const violations = files.flatMap((file) => file.violations).sort(compareViolations);

  return {
    files,
    violations,
    counts: countViolations(violations),
    filesChecked: files.length,
    filesWithViolations: files.filter((file) => file.violations.length > 0).length,
    ...(input.designSystem === undefined ? {} : { designSystem: input.designSystem }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
  };
}

/**
 * Whether ANSI colour is appropriate.
 *
 * Exported so the CLI applies one consistent policy: `NO_COLOR` wins over
 * everything (it is a standard, and users who set it mean it), then an
 * explicit `FORCE_COLOR`, then whether output is actually a terminal.
 */
export function shouldUseColor(
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
): boolean {
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0') return true;
  if (env['CI'] !== undefined && env['CI'] !== '') return false;
  return isTty;
}
