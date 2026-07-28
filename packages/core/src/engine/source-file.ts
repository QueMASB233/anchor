/**
 * Source files, parsed to an AST.
 *
 * SECURITY: this is the layer that touches the code under test, and it only
 * ever reads it as text. There is no `project` option, no module resolution and
 * no type information, because all three would mean reading and interpreting
 * more of the target repository than Anchor is willing to.
 *
 * The parser is deliberately permissive — `jsx: true` for every file, TypeScript
 * syntax always allowed — so a `.js` file containing JSX still lints rather than
 * failing on syntax the extension did not promise.
 */

import { parse, type TSESTree } from '@typescript-eslint/typescript-estree';

/** A 1-based position, matching what editors and SARIF expect. */
export interface Position {
  line: number;
  column: number;
}

export interface SourceFile {
  /** Path as supplied by the caller. Never opened. */
  path: string;
  text: string;
  ast: TSESTree.Program;
  comments: readonly TSESTree.Comment[];
  /** Converts an absolute character offset to a 1-based line and column. */
  positionAt(offset: number): Position;
}

export interface ParseFileResult {
  file: SourceFile | null;
  /** Populated when the file could not be parsed at all. */
  error?: { message: string; line?: number; column?: number };
}

/** Precomputes line start offsets so position lookup is a binary search. */
function buildLineIndex(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10 /* \n */) starts.push(index + 1);
  }
  return starts;
}

function makePositionAt(lineStarts: readonly number[]): (offset: number) => Position {
  return (offset: number): Position => {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }

    return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
  };
}

/**
 * Parses source text.
 *
 * Never throws: a syntax error in the code under test is data, not a crash. In
 * CI that code arrives from a pull request, and one unparseable file must not
 * take down the whole run.
 */
export function parseSourceFile(path: string, text: string): ParseFileResult {
  try {
    const ast = parse(text, {
      jsx: true,
      loc: true,
      range: true,
      comment: true,
      tokens: false,
      errorOnUnknownASTType: false,
    });

    const lineStarts = buildLineIndex(text);

    return {
      file: {
        path,
        text,
        ast,
        comments: ast.comments ?? [],
        positionAt: makePositionAt(lineStarts),
      },
    };
  } catch (error) {
    const parseError = error as { message?: unknown; lineNumber?: unknown; column?: unknown };
    return {
      file: null,
      error: {
        message: typeof parseError.message === 'string' ? parseError.message : String(error),
        ...(typeof parseError.lineNumber === 'number' ? { line: parseError.lineNumber } : {}),
        ...(typeof parseError.column === 'number' ? { column: parseError.column } : {}),
      },
    };
  }
}

/** File extensions the JSX/TSX linter understands. */
export const LINTABLE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.mts', '.mjs'] as const;

export function isLintable(path: string): boolean {
  return LINTABLE_EXTENSIONS.some((extension) => path.endsWith(extension));
}
