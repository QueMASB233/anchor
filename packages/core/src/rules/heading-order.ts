/**
 * heading-order — flags a jump from `h1` straight to `h3`.
 *
 * The only accessibility rule in the set, and it earns its place: screen reader
 * users navigate by heading structure, so a skipped level removes a landmark
 * they rely on. Models generate skipped levels constantly, because visually the
 * result looks fine.
 *
 * Scoped per file and evaluated in source order. Heading level is a property of
 * the rendered document, which a single component file cannot fully know, so
 * this is a warning rather than an error.
 */

import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

import { jsxElementName } from '../engine/jsx.js';
import { defineRule, option, type RuleContext } from './rule.js';

const HEADING_PATTERN = /^h([1-6])$/;

export const headingOrder = defineRule({
  meta: {
    id: 'heading-order',
    description: 'Heading levels must not skip a level.',
    defaultSeverity: 'warning',
    fixability: 'none',
    rationale:
      'Screen reader users navigate by heading structure. A skipped level removes a landmark, and the page looks identical so nobody notices.',
  },

  create(context: RuleContext) {
    // A component rendering only an `h3` is normal: its parent supplies the
    // `h2`. Requiring every file to start at `h1` would be noise.
    const requireTopLevel = option(context.options, 'requireH1', false);

    let previousLevel: number | null = null;

    return {
      jsxElement(node) {
        const name = jsxElementName(node.openingElement);
        if (name === null) return;

        // A dynamic `<Tag>` where Tag is `h${n}` cannot be resolved statically.
        const match = HEADING_PATTERN.exec(name);
        if (match?.[1] === undefined) return;

        const level = Number.parseInt(match[1], 10);
        const range: [number, number] = [
          node.openingElement.range[0],
          node.openingElement.range[1],
        ];

        if (previousLevel === null) {
          if (requireTopLevel && level !== 1) {
            context.report({
              message: `This file's first heading is \`h${level}\`. Start at \`h1\`.`,
              range,
            });
          }
          previousLevel = level;
          return;
        }

        if (level > previousLevel + 1) {
          const expected = previousLevel + 1;
          context.report({
            message: `Heading level jumps from \`h${previousLevel}\` to \`h${level}\`. Use \`h${expected}\` instead, or restructure the section.`,
            range,
            suggestedFix: `h${expected}`,
          });
        }

        previousLevel = level;
      },

      node(node) {
        // A file can also contain literal heading tags inside strings we do not
        // parse; nothing to do there. This hook exists so the rule participates
        // in the single AST walk even when no JSX headings are present.
        if (node.type === AST_NODE_TYPES.Program) previousLevel = null;
      },
    };
  },
});
