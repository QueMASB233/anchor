/**
 * no-custom-shadows — flags `shadow-[0_4px_8px_rgba(0,0,0,0.1)]`.
 *
 * A warning: elevation is one of the places a designer legitimately reaches for
 * a one-off, and a hard error would be overreach. Anchor still says so, because
 * an ad-hoc shadow is usually an existing token written from memory.
 */

import { findShadowToken, normalizeShadow } from '../model/index.js';
import {
  formatClass,
  matchUtility,
  parseClass,
  SHADOW_UTILITIES,
} from '../engine/tailwind-class.js';
import { defineRule, type RuleContext } from './rule.js';

export const noCustomShadows = defineRule({
  meta: {
    id: 'no-custom-shadows',
    description: 'Shadows must come from the design system elevation scale.',
    defaultSeverity: 'warning',
    fixability: 'partial',
    rationale:
      'Elevation carries meaning about layering. Ad-hoc shadows break that language and rarely match the scale they were eyeballed from.',
  },

  create(context: RuleContext) {
    const shadow = context.designSystem.tokens.shadow;

    return {
      classToken(token) {
        const parsed = parseClass(token.value);
        if (parsed.arbitrary === null) return;

        const matched = matchUtility(parsed.base, SHADOW_UTILITIES);
        if (matched === null) return;

        // An exact match against a defined token is safe to rewrite.
        const existing = shadow === undefined ? null : findShadowToken(shadow, parsed.arbitrary);

        if (existing !== null) {
          const replacement = formatClass(parsed, `${matched.utility}-${existing.name}`);
          context.report({
            message: `\`${token.value}\` writes out a shadow that already exists as \`${existing.name}\`. Use \`${replacement}\`.`,
            range: token.range,
            suggestedFix: replacement,
            fix: { range: token.range, text: replacement },
          });
          return;
        }

        const available =
          shadow === undefined || shadow.tokens.length === 0
            ? 'The design system defines no shadow tokens; add one rather than inlining this.'
            : `Available: ${shadow.tokens.map((entry) => `\`${entry.name}\``).join(', ')}.`;

        context.report({
          message: `\`${normalizeShadow(parsed.arbitrary)}\` is a custom shadow that is not in the design system. ${available}`,
          range: token.range,
        });
      },
    };
  },
});
