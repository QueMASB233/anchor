/**
 * Figma variables, as returned by the REST "Get local variables" endpoint.
 *
 * Anchor targets the documented API shape rather than any particular plugin's
 * export, because the API shape is stable and the plugin formats are not. A
 * file that does not match it is reported clearly rather than half-parsed.
 *
 * Figma names variables with slashes (`color/brand/primary`), which are
 * converted to the dashed names design systems actually consume. Colours arrive
 * as normalized 0–1 RGBA floats and are converted back to hex.
 */

import { createDesignSystem } from '../model/index.js';
import { buildTokens, type ClassifiedToken } from './build-tokens.js';
import { classifyToken } from './token-tree.js';
import type { Parser, ParserContext, ParserInput, ParseResult, ParseWarning } from './types.js';

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface FigmaVariable {
  name?: unknown;
  resolvedType?: unknown;
  valuesByMode?: unknown;
  variableCollectionId?: unknown;
  description?: unknown;
  deletedButReferenced?: unknown;
  scopes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFigmaColor(value: unknown): value is FigmaColor {
  return (
    isRecord(value) &&
    typeof value['r'] === 'number' &&
    typeof value['g'] === 'number' &&
    typeof value['b'] === 'number'
  );
}

function channel(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
}

/** Converts Figma's 0–1 RGBA to a CSS colour, keeping alpha only when meaningful. */
export function figmaColorToCss(color: FigmaColor): string {
  const hex = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
  const alpha = color.a ?? 1;
  if (alpha >= 1) return hex;
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${Number(alpha.toFixed(3))})`;
}

/** `color/brand/primary` -> `color-brand-primary`, and the path segments. */
function splitFigmaName(name: string): { name: string; path: string[] } {
  const path = name
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  return { name: path.join('-'), path };
}

const TYPE_MAP: Readonly<Record<string, string>> = {
  COLOR: 'color',
  FLOAT: 'dimension',
  STRING: 'string',
  BOOLEAN: 'boolean',
};

export function parseFigmaVariables(
  inputs: readonly ParserInput[],
  context: ParserContext = {},
): ParseResult {
  const warnings: ParseWarning[] = [];
  const classified: ClassifiedToken[] = [];
  const sourceFiles: string[] = [];

  for (const input of inputs) {
    sourceFiles.push(input.path);

    let json: unknown;
    try {
      json = JSON.parse(input.content);
    } catch (error) {
      warnings.push({
        code: 'parse-error',
        message: `Could not parse ${input.path} as JSON: ${error instanceof Error ? error.message : String(error)}`,
        file: input.path,
      });
      continue;
    }

    // The endpoint wraps its payload in `meta`; exports sometimes unwrap it.
    const root = isRecord(json) && isRecord(json['meta']) ? json['meta'] : json;
    const variables = isRecord(root) ? root['variables'] : undefined;

    if (!isRecord(variables)) {
      warnings.push({
        code: 'unsupported-construct',
        message: `${input.path} does not look like a Figma variables export. Anchor expects the shape returned by the "Get local variables" REST endpoint, with a \`variables\` map.`,
        file: input.path,
      });
      continue;
    }

    const collections =
      isRecord(root) && isRecord(root['variableCollections']) ? root['variableCollections'] : {};

    // Resolving an alias needs a name for the variable it points at.
    const nameById = new Map<string, string>();
    for (const [id, raw] of Object.entries(variables)) {
      if (isRecord(raw) && typeof raw['name'] === 'string') {
        nameById.set(id, splitFigmaName(raw['name']).name);
      }
    }

    for (const [id, raw] of Object.entries(variables)) {
      if (!isRecord(raw)) continue;
      const variable = raw as FigmaVariable;

      if (typeof variable.name !== 'string' || variable.name === '') {
        warnings.push({
          code: 'unsupported-construct',
          message: `Skipped a Figma variable (${id}) because it has no name.`,
          file: input.path,
        });
        continue;
      }

      // Figma keeps soft-deleted variables in the payload.
      if (variable.deletedButReferenced === true) continue;

      const { name, path } = splitFigmaName(variable.name);
      const modes = isRecord(variable.valuesByMode) ? variable.valuesByMode : {};
      const modeIds = Object.keys(modes);

      if (modeIds.length === 0) {
        warnings.push({
          code: 'unresolvable-value',
          message: `Figma variable \`${variable.name}\` has no value in any mode.`,
          file: input.path,
          path: variable.name,
        });
        continue;
      }

      // Multi-mode variables (light/dark) collapse to the collection's default
      // mode. Enforcing per-mode values needs mode-aware rules, which v1 does
      // not have, so the extra modes are reported rather than silently dropped.
      const collectionId = variable.variableCollectionId;
      const collection = typeof collectionId === 'string' ? collections[collectionId] : undefined;
      const defaultModeId =
        isRecord(collection) && typeof collection['defaultModeId'] === 'string'
          ? collection['defaultModeId']
          : undefined;

      const modeId =
        defaultModeId !== undefined && defaultModeId in modes ? defaultModeId : modeIds[0]!;

      if (modeIds.length > 1) {
        warnings.push({
          code: 'unsupported-construct',
          message: `Figma variable \`${variable.name}\` has ${modeIds.length} modes. Anchor used the default mode only; per-mode enforcement is not supported yet.`,
          file: input.path,
          path: variable.name,
        });
      }

      const rawValue = modes[modeId];
      let value: string | undefined;
      let reference: string | undefined;

      if (isRecord(rawValue) && rawValue['type'] === 'VARIABLE_ALIAS') {
        const targetId = rawValue['id'];
        const target = typeof targetId === 'string' ? nameById.get(targetId) : undefined;
        if (target === undefined) {
          warnings.push({
            code: 'dangling-reference',
            message: `Figma variable \`${variable.name}\` aliases a variable that is not in this export.`,
            file: input.path,
            path: variable.name,
          });
          continue;
        }
        reference = target;
        value = `{${target}}`;
      } else if (isFigmaColor(rawValue)) {
        value = figmaColorToCss(rawValue);
      } else if (typeof rawValue === 'number') {
        value = String(rawValue);
      } else if (typeof rawValue === 'string' || typeof rawValue === 'boolean') {
        value = String(rawValue);
      }

      if (value === undefined) {
        warnings.push({
          code: 'unresolvable-value',
          message: `Figma variable \`${variable.name}\` has a value Anchor does not understand.`,
          file: input.path,
          path: variable.name,
        });
        continue;
      }

      const declaredType =
        typeof variable.resolvedType === 'string' ? TYPE_MAP[variable.resolvedType] : undefined;
      const group = classifyToken(path, declaredType);

      classified.push({
        name,
        value,
        group,
        ...(group === 'custom' ? { customGroup: path[0] ?? 'other' } : {}),
        ...(reference === undefined ? {} : { reference }),
        ...(typeof variable.description === 'string' && variable.description !== ''
          ? { description: variable.description }
          : {}),
        provenance: { file: input.path, path: variable.name },
      });
    }
  }

  return {
    designSystem: createDesignSystem({
      meta: {
        name: context.name ?? 'Figma design system',
        source: 'figma-variables',
        sourceFiles,
      },
      tokens: buildTokens(classified, {
        ...(context.rootFontSize === undefined ? {} : { rootFontSize: context.rootFontSize }),
      }),
    }),
    warnings,
  };
}

export const figmaVariablesParser: Parser = {
  format: 'figma-variables',
  displayName: 'Figma Variables',

  detect(input: ParserInput): number {
    if (!/\.json$/i.test(input.path)) return 0;
    if (/"variableCollectionId"\s*:/.test(input.content)) return 1;
    if (/"resolvedType"\s*:/.test(input.content) && /"valuesByMode"\s*:/.test(input.content)) {
      return 1;
    }
    if (/"variableCollections"\s*:/.test(input.content)) return 0.9;
    return 0;
  },

  parse: parseFigmaVariables,
};
