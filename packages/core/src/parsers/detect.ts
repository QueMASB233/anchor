/**
 * Format auto-detection.
 *
 * Drives the zero-config path: point Anchor at a repository and it works out
 * which format the design system is in.
 *
 * Detection is decided by unambiguous signals, not fuzzy scoring — a `@theme`
 * block, a `$value` key, a `variableCollectionId`. Where two formats genuinely
 * overlap (a Style Dictionary file and a DTCG file are both JSON with nested
 * groups), the more specific signal wins, and the runner-up stays visible in
 * `candidates` so the CLI can explain the choice instead of appearing arbitrary.
 */

import type { SourceFormat } from '../model/index.js';
import { cssVariablesParser } from './css-variables.js';
import { figmaVariablesParser } from './figma-variables.js';
import { styleDictionaryParser } from './style-dictionary.js';
import { tailwindParser } from './tailwind/index.js';
import type { Parser, ParserContext, ParserInput, ParseResult } from './types.js';
import { w3cDtcgParser } from './w3c-dtcg.js';

/**
 * Registered parsers, most specific first. Order breaks exact score ties, so a
 * Tailwind config beats a generic JSON reading of the same file.
 */
export const PARSERS: readonly Parser[] = [
  tailwindParser,
  figmaVariablesParser,
  w3cDtcgParser,
  styleDictionaryParser,
  cssVariablesParser,
];

export interface FormatCandidate {
  format: SourceFormat;
  displayName: string;
  /** Highest score any input scored for this parser. */
  score: number;
  /** Only the inputs this parser claimed, best first. */
  files: ParserInput[];
}

export interface DetectionResult {
  /** The winning parser, or `null` when nothing matched. */
  parser: Parser | null;
  format: SourceFormat;
  /** Every parser that claimed at least one file, best first. */
  candidates: FormatCandidate[];
}

/** Minimum score for a parser to be considered a match at all. */
const MINIMUM_SCORE = 0.5;

export function detectFormat(inputs: readonly ParserInput[]): DetectionResult {
  const candidates: FormatCandidate[] = [];

  for (const parser of PARSERS) {
    const scored = inputs
      .map((input) => ({ input, score: parser.detect(input) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best === undefined || best.score < MINIMUM_SCORE) continue;

    candidates.push({
      format: parser.format,
      displayName: parser.displayName,
      score: best.score,
      files: scored.map((entry) => entry.input),
    });
  }

  // Stable sort keeps PARSERS order as the tie-break.
  candidates.sort((a, b) => b.score - a.score);

  const winner = candidates[0];
  if (winner === undefined) {
    return { parser: null, format: 'unknown', candidates: [] };
  }

  return {
    parser: PARSERS.find((parser) => parser.format === winner.format) ?? null,
    format: winner.format,
    candidates,
  };
}

/** Raised when auto-detection finds nothing it can parse. */
export class UnknownFormatError extends Error {
  override readonly name = 'UnknownFormatError';

  constructor(readonly inspected: readonly string[]) {
    super(
      inspected.length === 0
        ? 'Anchor found no design system files to read.'
        : `Anchor could not identify a design system format in: ${inspected.join(', ')}. Supported formats are Tailwind (config or @theme CSS), Style Dictionary, W3C design tokens, Figma variables, and CSS custom properties.`,
    );
  }
}

/**
 * Detects the format and parses in one step.
 *
 * @throws {UnknownFormatError} when no parser claims the input.
 */
export function parseAuto(
  inputs: readonly ParserInput[],
  context: ParserContext = {},
): ParseResult & { format: SourceFormat } {
  const detection = detectFormat(inputs);

  if (detection.parser === null) {
    throw new UnknownFormatError(inputs.map((input) => input.path));
  }

  const claimed = detection.candidates[0]?.files ?? [];
  const result = detection.parser.parse(claimed, context);
  return { ...result, format: detection.format };
}
