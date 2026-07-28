/**
 * The parser contract.
 *
 * Two properties of this interface are load-bearing for Anchor's security
 * posture, and neither is an accident:
 *
 * 1. Parsers receive file *contents as text*. They never touch the filesystem
 *    and never resolve imports. The caller does all I/O, which makes it
 *    structurally impossible for a parser to reach beyond the files it was
 *    handed.
 * 2. Parsers are pure and synchronous. No network, no child processes, no
 *    dynamic import. A parser cannot execute the project it is reading.
 *
 * Parsers report what they could not understand through `warnings` rather than
 * throwing or guessing. Static analysis of a dynamic config will always have
 * blind spots; the honest response is to say so, loudly, at the exact location.
 */

import type { DesignSystem, SourceFormat } from '../model/index.js';

/** Machine-readable reasons a parser could not fully understand its input. */
export type ParseWarningCode =
  /** An expression could not be resolved without executing code. */
  | 'unresolvable-expression'
  /** A syntactically valid construct this parser does not model. */
  | 'unsupported-construct'
  /** The input could not be parsed at all. */
  | 'parse-error'
  /** A token value was present but could not be normalized. */
  | 'unresolvable-value'
  /** A reference pointed at something that does not exist. */
  | 'dangling-reference'
  /** Two sources defined the same token differently. */
  | 'duplicate-token';

export interface ParseWarning {
  code: ParseWarningCode;
  /** Written for the developer who has to act on it. */
  message: string;
  /** File the warning relates to, as supplied to the parser. */
  file?: string;
  /** Path within that file, e.g. `theme.extend.colors.brand`. */
  path?: string;
  line?: number;
  column?: number;
}

/** One file handed to a parser. */
export interface ParserInput {
  /** Path used only for reporting. Parsers never open it. */
  path: string;
  /** Full file contents. */
  content: string;
}

export interface ParserContext {
  /** Display name for the design system. Defaults to the package or directory name. */
  name?: string;
  /** Root font size used to resolve `rem` values. Defaults to 16. */
  rootFontSize?: number;
}

export interface ParseResult {
  designSystem: DesignSystem;
  /** Everything the parser could not follow. Surfaced by `anchor sync`. */
  warnings: ParseWarning[];
}

/**
 * How strongly a parser believes it can handle a given file.
 *
 * `0` means "not mine". Higher wins during auto-detection. Scores are
 * deliberately coarse — detection should be decided by unambiguous signals
 * (a `@theme` block, a `$schema` key) rather than by fine-grained scoring.
 */
export type DetectionScore = number;

export interface Parser {
  /** The format this parser produces in `meta.source`. */
  readonly format: SourceFormat;
  /** Human-readable name, used in CLI output. */
  readonly displayName: string;
  /**
   * Scores how confidently this parser handles `input`, from 0 (not mine) to
   * 1 (certain). Must be cheap: detection runs across many candidate files.
   */
  detect(input: ParserInput): DetectionScore;
  /** Parses one or more files into a normalized design system. */
  parse(inputs: readonly ParserInput[], context?: ParserContext): ParseResult;
}

/** Collects warnings without every call site threading an array around. */
export class WarningCollector {
  private readonly warnings: ParseWarning[] = [];

  add(warning: ParseWarning): void {
    this.warnings.push(warning);
  }

  addAll(warnings: readonly ParseWarning[]): void {
    this.warnings.push(...warnings);
  }

  /** Returns the collected warnings, deduplicated by code, path and message. */
  collect(): ParseWarning[] {
    const seen = new Set<string>();
    return this.warnings.filter((warning) => {
      const key = `${warning.code}|${warning.file ?? ''}|${warning.path ?? ''}|${warning.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get length(): number {
    return this.warnings.length;
  }
}
