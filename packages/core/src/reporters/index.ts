/**
 * Violation formatters.
 *
 * Every reporter is a pure function from report to string. Nothing here writes
 * a file, prints to a stream, or reads the environment — the CLI owns all of
 * that, so reporters stay testable and their output is identical everywhere.
 */

import { githubReporter } from './github.js';
import { jsonReporter } from './json.js';
import { sarifReporter } from './sarif.js';
import { terminalReporter } from './terminal.js';
import type { Reporter, ReporterFormat } from './types.js';

export * from './github.js';
export * from './json.js';
export * from './sarif.js';
export * from './terminal.js';
export * from './types.js';

export const REPORTERS: readonly Reporter[] = [
  terminalReporter,
  jsonReporter,
  sarifReporter,
  githubReporter,
];

export const REPORTER_FORMATS: readonly ReporterFormat[] = REPORTERS.map(
  (reporter) => reporter.format,
);

export function getReporter(format: ReporterFormat): Reporter {
  const reporter = REPORTERS.find((candidate) => candidate.format === format);
  if (reporter === undefined) {
    throw new Error(
      `Unknown reporter format: ${format}. Available: ${REPORTER_FORMATS.join(', ')}.`,
    );
  }
  return reporter;
}
