/**
 * no-raw-hex-colors — flags hard-coded colours in classes and inline styles.
 *
 * Only *partially* auto-fixable, and the distinction matters. When the hex
 * matches a defined token exactly, the replacement is certain and safe. When it
 * does not, there is no correct answer to apply: suggesting the visually
 * nearest colour would silently change the design, so the rule reports and
 * leaves the decision to a human.
 */

import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

import { findColorTokensByHex, normalizeColor } from '../model/index.js';
import {
  COLOR_UTILITIES,
  formatClass,
  matchUtility,
  parseClass,
} from '../engine/tailwind-class.js';
import { defineRule, type RuleContext } from './rule.js';

/** CSS properties whose value is a colour, for the inline-style pass. */
const COLOR_PROPERTIES = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'fill',
  'stroke',
  'caretColor',
  'accentColor',
  'textDecorationColor',
  'columnRuleColor',
]);

export const noRawHexColors = defineRule({
  meta: {
    id: 'no-raw-hex-colors',
    description: 'Colours must come from the design system, not be written literally.',
    defaultSeverity: 'error',
    fixability: 'partial',
    rationale:
      'A literal colour cannot be changed centrally. Every hard-coded hex is a place a rebrand or a dark mode will miss.',
  },

  create(context: RuleContext) {
    const { color } = context.designSystem.tokens;

    /** Reports one literal colour, offering a fix only when a token matches. */
    const reportColor = (
      raw: string,
      range: [number, number],
      buildReplacement: (tokenName: string) => string | null,
    ): void => {
      const normalized = normalizeColor(raw);
      if (normalized === null) return;

      const matches = findColorTokensByHex(color, normalized.hex);
      // Prefer a semantic token: it is the answer we want the author to reach
      // for, not merely the one that happens to match.
      const best = matches.find((token) => token.kind === 'semantic') ?? matches[0];

      if (best === undefined) {
        context.report({
          message: `\`${raw}\` is a hard-coded colour and does not match any design system token. Add it to the design system, or use an existing token.`,
          range,
        });
        return;
      }

      const replacement = buildReplacement(best.name);
      if (replacement === null) {
        context.report({
          message: `\`${raw}\` is a hard-coded colour. It matches the token \`${best.name}\`; use that instead.`,
          range,
          suggestedFix: best.name,
        });
        return;
      }

      context.report({
        message: `\`${raw}\` is a hard-coded colour. Use \`${replacement}\` instead.`,
        range,
        suggestedFix: replacement,
        fix: { range, text: replacement },
      });
    };

    return {
      classToken(token) {
        const parsed = parseClass(token.value);
        if (parsed.arbitrary === null) return;

        const matched = matchUtility(parsed.base, COLOR_UTILITIES);
        if (matched === null) return;
        if (normalizeColor(parsed.arbitrary) === null) return;

        reportColor(parsed.arbitrary, token.range, (tokenName) =>
          formatClass(parsed, `${matched.utility}-${tokenName}`),
        );
      },

      node(node) {
        // Inline `style={{ color: '#2D3748' }}`. `no-inline-styles` flags the
        // construct; this rule flags the literal colour inside it, since a team
        // may reasonably enable one rule and not the other.
        if (node.type !== AST_NODE_TYPES.Property) return;

        const key =
          node.key.type === AST_NODE_TYPES.Identifier
            ? node.key.name
            : node.key.type === AST_NODE_TYPES.Literal && typeof node.key.value === 'string'
              ? node.key.value
              : null;

        if (key === null || !COLOR_PROPERTIES.has(key)) return;
        if (node.value.type !== AST_NODE_TYPES.Literal) return;
        if (typeof node.value.value !== 'string') return;

        const literal = node.value;
        // Report the string contents, excluding the quotes.
        reportColor(literal.value, [literal.range[0] + 1, literal.range[1] - 1], () => null);
      },
    };
  },
});
