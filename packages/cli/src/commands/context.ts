/**
 * What every command receives.
 *
 * Passed in rather than read from globals, so tests drive commands with a fake
 * UI and a temporary directory and assert on the exact output.
 */

import type { AnchorConfig } from '../config.js';
import type { Ui } from '../ui.js';

export interface CommandContext {
  ui: Ui;
  /** Absolute project root. Every path in output is relative to it. */
  cwd: string;
  /** Anchor's version, reported in output and mixed into the cache key. */
  version: string;
  config: AnchorConfig;
  /** Where the config came from, or `null` when running on defaults. */
  configPath: string | null;
}

/** Process exit codes, so callers and CI can distinguish outcomes. */
export const EXIT = {
  ok: 0,
  /** Violations found, and the run was configured to fail on them. */
  violations: 1,
  /** Anchor could not do its job: bad config, no design system, git failure. */
  error: 2,
} as const;
