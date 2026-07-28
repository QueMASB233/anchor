/**
 * no-inline-styles — flags `style={{ ... }}`.
 *
 * Not auto-fixable, and that is a design decision rather than a gap. Removing
 * an inline style correctly means deciding where the value belongs: a utility
 * class, a new component variant, or a genuine exception. A tool that guessed
 * would produce a diff nobody could review.
 *
 * Genuinely dynamic styles — a computed width, a CSS custom property carrying a
 * runtime value — are exempt by default, because there is no static answer for
 * them and flagging them would only teach people to suppress the rule.
 */

import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

import { defineRule, option, type RuleContext } from './rule.js';

export const noInlineStyles = defineRule({
  meta: {
    id: 'no-inline-styles',
    description: 'Use design system classes rather than inline style objects.',
    defaultSeverity: 'error',
    fixability: 'none',
    rationale:
      'Inline styles bypass the design system entirely and win over it in the cascade, so a token change silently fails to reach them.',
  },

  create(context: RuleContext) {
    const allowDynamic = option(context.options, 'allowDynamic', true);
    const allowCssVariables = option(context.options, 'allowCssVariables', true);

    return {
      node(node) {
        if (node.type !== AST_NODE_TYPES.JSXAttribute) return;
        if (node.name.type !== AST_NODE_TYPES.JSXIdentifier || node.name.name !== 'style') return;

        const value = node.value;
        if (value === null || value.type !== AST_NODE_TYPES.JSXExpressionContainer) return;

        const expression = value.expression;
        if (expression.type !== AST_NODE_TYPES.ObjectExpression) return;

        const properties = expression.properties.filter(
          (property) => property.type === AST_NODE_TYPES.Property,
        );

        // An empty or fully spread object says nothing worth reporting.
        if (properties.length === 0) return;

        const staticProperties = properties.filter(
          (property) => property.value.type === AST_NODE_TYPES.Literal,
        );

        const propertyNames = properties.map((property) =>
          property.key.type === AST_NODE_TYPES.Identifier
            ? property.key.name
            : property.key.type === AST_NODE_TYPES.Literal
              ? String(property.key.value)
              : '',
        );

        // `style={{ '--progress': pct }}` is the sanctioned way to hand a
        // runtime value to CSS. Treating it as a violation would be wrong.
        if (allowCssVariables && propertyNames.every((name) => name.startsWith('--'))) return;

        if (allowDynamic && staticProperties.length === 0) return;

        const named = propertyNames.filter((name) => name !== '');
        const detail =
          named.length === 0 ? '' : ` It sets ${named.map((name) => `\`${name}\``).join(', ')}.`;

        context.report({
          message: `Inline styles bypass the design system.${detail} Move this to a utility class, or add a variant to the component so the variation is part of its API.`,
          range: [node.range[0], node.range[1]],
        });
      },
    };
  },
});
