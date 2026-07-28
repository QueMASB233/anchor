/**
 * no-arbitrary-spacing — flags `p-[13px]` and friends.
 *
 * The most common way AI-generated UI drifts off-system: a model picks a value
 * that looks right rather than one that exists, and the result is a codebase
 * where nothing quite lines up.
 *
 * Auto-fixable, because the correct answer is unambiguous — the nearest value
 * on the scale — and the edit is a pure substitution.
 */

import { isOnSpacingScale, nearestSpacingToken, toPx } from '../model/index.js';
import {
  formatClass,
  matchUtility,
  parseClass,
  SPACING_UTILITIES,
} from '../engine/tailwind-class.js';
import { defineRule, option, type RuleContext } from './rule.js';

export const noArbitrarySpacing = defineRule({
  meta: {
    id: 'no-arbitrary-spacing',
    description: 'Spacing utilities must use a value from the design system scale.',
    defaultSeverity: 'error',
    fixability: 'auto',
    rationale:
      'Off-scale spacing is what makes a UI feel subtly wrong. It compounds: once one arbitrary value exists, the next is justified by it.',
  },

  create(context: RuleContext) {
    const { spacing } = context.designSystem.tokens;

    // With no scale there is nothing to check against, and flagging every
    // arbitrary value would be noise rather than signal.
    if (spacing.tokens.length === 0) return {};

    const tolerance = option(context.options, 'tolerancePx', 0);

    return {
      classToken(token) {
        const parsed = parseClass(token.value);
        if (parsed.arbitrary === null) return;

        const matched = matchUtility(parsed.base, SPACING_UTILITIES);
        if (matched === null) return;

        const px = toPx(parsed.arbitrary, spacing.rootFontSize);
        // Not a fixed length: `p-[calc(100%-1rem)]` is deliberate, not a slip.
        if (px === null) return;

        if (isOnSpacingScale(spacing, Math.abs(px))) {
          // The value is on the scale, just written the long way. Still worth
          // replacing with the token name, but it is not a design violation.
          return;
        }

        const nearest = nearestSpacingToken(spacing, Math.abs(px));
        if (nearest === null) return;

        const distance =
          nearest.px === null ? Number.POSITIVE_INFINITY : Math.abs(nearest.px - Math.abs(px));
        if (distance <= tolerance) return;

        const replacement = formatClass(parsed, `${matched.utility}-${nearest.name}`);
        const suffix =
          spacing.baseUnit === null ? '' : ` The scale is based on ${spacing.baseUnit}px steps.`;

        context.report({
          message: `\`${token.value}\` uses an arbitrary spacing value. Use \`${replacement}\` (${nearest.px}px) instead.${suffix}`,
          range: token.range,
          suggestedFix: replacement,
          fix: { range: token.range, text: replacement },
        });
      },
    };
  },
});
