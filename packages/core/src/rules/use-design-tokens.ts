/**
 * use-design-tokens — nudges `text-gray-500` toward `text-secondary`.
 *
 * A warning rather than an error, deliberately. Using a palette value is not
 * broken code, it is code that will age badly, and treating it as a build
 * failure would make the rule the first thing a team turns off.
 */

import { findSemanticAlternatives } from '../model/index.js';
import {
  COLOR_UTILITIES,
  formatClass,
  matchUtility,
  parseClass,
} from '../engine/tailwind-class.js';
import { defineRule, type RuleContext } from './rule.js';

export const useDesignTokens = defineRule({
  meta: {
    id: 'use-design-tokens',
    description: 'Prefer semantic colour tokens over raw palette values.',
    defaultSeverity: 'warning',
    fixability: 'auto',
    rationale:
      'Semantic tokens carry intent, so a rebrand or a theme change is one edit. Palette values scatter that decision across every file that used them.',
  },

  create(context: RuleContext) {
    const { color } = context.designSystem.tokens;
    if (color.tokens.length === 0) return {};

    const byName = new Map(color.tokens.map((token) => [token.name, token]));

    return {
      classToken(token) {
        const parsed = parseClass(token.value);
        // An arbitrary value is `no-raw-hex-colors`' problem, not this rule's.
        if (parsed.arbitrary !== null) return;

        const matched = matchUtility(parsed.base, COLOR_UTILITIES);
        if (matched === null) return;

        const used = byName.get(matched.value);
        if (used === undefined || used.kind !== 'palette') return;

        const alternatives = findSemanticAlternatives(color, used);
        const preferred = alternatives[0];
        if (preferred === undefined) return;

        const replacement = formatClass(parsed, `${matched.utility}-${preferred.name}`);
        const others =
          alternatives.length > 1
            ? ` (also available: ${alternatives
                .slice(1, 4)
                .map((alternative) => `\`${alternative.name}\``)
                .join(', ')})`
            : '';

        context.report({
          message: `\`${token.value}\` uses the palette value \`${used.name}\` directly. Use the semantic token \`${replacement}\` instead${others}.`,
          range: token.range,
          suggestedFix: replacement,
          fix: { range: token.range, text: replacement },
        });
      },
    };
  },
});
