/**
 * The rule registry.
 *
 * The single place that knows every rule Anchor ships. The CLI, the config
 * schema and the context generators all read from here, so adding a rule is one
 * import and one array entry rather than a hunt through the codebase.
 */

import type { Severity } from '../model/index.js';
import { compositionRules } from './composition-rules.js';
import { headingOrder } from './heading-order.js';
import { noArbitrarySpacing } from './no-arbitrary-spacing.js';
import { noCustomShadows } from './no-custom-shadows.js';
import { noInlineStyles } from './no-inline-styles.js';
import { noRawHexColors } from './no-raw-hex-colors.js';
import type { Rule } from './rule.js';
import { useDesignTokens } from './use-design-tokens.js';
import { validComponentVariants } from './valid-component-variants.js';

export * from './rule.js';
export {
  compositionRules,
  headingOrder,
  noArbitrarySpacing,
  noCustomShadows,
  noInlineStyles,
  noRawHexColors,
  useDesignTokens,
  validComponentVariants,
};

/** Every built-in rule, in the order they are documented. */
export const ALL_RULES: readonly Rule[] = [
  noArbitrarySpacing,
  noRawHexColors,
  useDesignTokens,
  noInlineStyles,
  validComponentVariants,
  compositionRules,
  noCustomShadows,
  headingOrder,
];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(
  ALL_RULES.map((rule) => [rule.meta.id, rule]),
);

export function getRule(id: string): Rule | null {
  return RULES_BY_ID.get(id) ?? null;
}

/** Rule ids, for config validation and `--rule` filtering. */
export const RULE_IDS: readonly string[] = ALL_RULES.map((rule) => rule.meta.id);

/** Default severity per rule, used to build a starter config. */
export const DEFAULT_RULE_SEVERITIES: Readonly<Record<string, Severity>> = Object.fromEntries(
  ALL_RULES.map((rule) => [rule.meta.id, rule.meta.defaultSeverity]),
);
