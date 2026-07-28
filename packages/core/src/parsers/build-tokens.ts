/**
 * Assembles classified tokens into the normalized token model.
 *
 * Every parser that is not Tailwind ends up with the same intermediate shape —
 * a flat list of named values tagged with the group they belong to — so the
 * final assembly is shared rather than repeated four times with four subtly
 * different sets of bugs.
 */

import {
  createColorSystem,
  createNamedTokens,
  createScaleTokens,
  createShadowSystem,
  createSpacingScale,
  createTypographySystem,
  type ColorTokenInput,
  type DesignTokens,
  type NamedTokenInput,
  type Provenance,
  type ScaleTokenInput,
  type ShadowTokenInput,
  type SpacingTokenInput,
  type TokenGroup,
} from '../model/index.js';
import type { TokenGroupKind } from './token-tree.js';

/** A token that has been named, valued and assigned to a group. */
export interface ClassifiedToken {
  name: string;
  value: string;
  group: TokenGroupKind;
  /** Sub-group name when `group` is `custom`, e.g. `zIndex`. */
  customGroup?: string;
  /** Name of the token this one aliases, when it is a reference. */
  reference?: string;
  description?: string;
  deprecated?: boolean;
  provenance?: Provenance;
}

export interface BuildTokensOptions {
  rootFontSize?: number;
  /** See `SpacingScale.dynamicMultiplier`. */
  dynamicMultiplier?: number;
}

/** Copies through only the metadata fields that were actually supplied. */
function meta(token: ClassifiedToken): {
  description?: string;
  deprecated?: boolean;
  provenance?: Provenance;
} {
  return {
    ...(token.description === undefined ? {} : { description: token.description }),
    ...(token.deprecated === undefined ? {} : { deprecated: token.deprecated }),
    ...(token.provenance === undefined ? {} : { provenance: token.provenance }),
  };
}

export function buildTokens(
  tokens: readonly ClassifiedToken[],
  options: BuildTokensOptions = {},
): DesignTokens {
  const byGroup = new Map<TokenGroupKind, ClassifiedToken[]>();
  for (const token of tokens) {
    const bucket = byGroup.get(token.group) ?? [];
    bucket.push(token);
    byGroup.set(token.group, bucket);
  }

  const of = (group: TokenGroupKind): ClassifiedToken[] => byGroup.get(group) ?? [];

  const asScale = (token: ClassifiedToken): ScaleTokenInput => ({
    name: token.name,
    value: token.value,
    ...meta(token),
  });
  const asSpacing = (token: ClassifiedToken): SpacingTokenInput => ({
    name: token.name,
    value: token.value,
    ...meta(token),
  });
  const asNamed = (token: ClassifiedToken): NamedTokenInput => ({
    name: token.name,
    value: token.value,
    ...meta(token),
  });
  const asShadow = (token: ClassifiedToken): ShadowTokenInput => ({
    name: token.name,
    value: token.value,
    ...meta(token),
  });
  const asColor = (token: ClassifiedToken): ColorTokenInput => ({
    name: token.name,
    value: token.value,
    // A token that aliases another is semantic by definition: it names an
    // intent and defers the actual colour to the palette entry it points at.
    ...(token.reference === undefined ? {} : { reference: token.reference, kind: 'semantic' }),
    ...meta(token),
  });

  const scaleOptions =
    options.rootFontSize === undefined ? {} : { rootFontSize: options.rootFontSize };

  const customTokens = of('custom');
  const custom: Record<string, TokenGroup> = {};
  for (const token of customTokens) {
    const groupName = token.customGroup ?? 'other';
    const existing = custom[groupName]?.tokens ?? [];
    custom[groupName] = {
      tokens: [...existing, ...createScaleTokens([asScale(token)], scaleOptions).tokens],
    };
  }

  const shadows = of('shadow');

  return {
    spacing: createSpacingScale(of('spacing').map(asSpacing), {
      ...scaleOptions,
      ...(options.dynamicMultiplier === undefined
        ? {}
        : { dynamicMultiplier: options.dynamicMultiplier }),
    }),
    color: createColorSystem(of('color').map(asColor)),
    typography: createTypographySystem({
      fontFamilies: createNamedTokens(of('fontFamily').map(asNamed)),
      fontSizes: createScaleTokens(of('fontSize').map(asScale), scaleOptions),
      fontWeights: createNamedTokens(of('fontWeight').map(asNamed)),
      lineHeights: createNamedTokens(of('lineHeight').map(asNamed)),
      letterSpacings: createScaleTokens(of('letterSpacing').map(asScale), scaleOptions),
    }),
    borderRadius: createScaleTokens(of('borderRadius').map(asScale), scaleOptions),
    ...(shadows.length === 0 ? {} : { shadow: createShadowSystem(shadows.map(asShadow)) }),
    ...(Object.keys(custom).length === 0 ? {} : { custom }),
  };
}
