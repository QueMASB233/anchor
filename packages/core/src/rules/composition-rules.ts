/**
 * composition-rules — flags Card inside Card, Form inside Form, and whatever
 * else the design system forbids.
 *
 * The descendant/child distinction from the model is load-bearing here. "A Card
 * must not contain a Card" has to survive arbitrary wrapper elements, so it is
 * checked against the whole ancestor chain. "A List accepts only ListItem
 * children" is about the immediate children only — a ListItem wrapped in a
 * fragment or a conditional is still legitimate.
 */

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/typescript-estree';

import type { CompositionRule } from '../model/index.js';
import { jsxAncestorNames, jsxElementName } from '../engine/jsx.js';
import { defineRule, type RuleContext } from './rule.js';

/**
 * Direct child elements, seeing through fragments and expression containers.
 *
 * `<List>{items.map(i => <ListItem/>)}</List>` must not read as "List has no
 * ListItem children", so wrappers that do not themselves render an element are
 * traversed rather than treated as children.
 */
function directChildElements(node: TSESTree.JSXElement): TSESTree.JSXElement[] {
  const found: TSESTree.JSXElement[] = [];

  const visit = (child: TSESTree.Node, depth: number): void => {
    if (depth > 8) return;

    if (child.type === AST_NODE_TYPES.JSXElement) {
      found.push(child);
      return;
    }
    if (child.type === AST_NODE_TYPES.JSXFragment) {
      for (const nested of child.children) visit(nested, depth + 1);
      return;
    }
    if (child.type === AST_NODE_TYPES.JSXExpressionContainer) {
      visit(child.expression, depth + 1);
      return;
    }
    if (
      child.type === AST_NODE_TYPES.ConditionalExpression ||
      child.type === AST_NODE_TYPES.LogicalExpression
    ) {
      const branches =
        child.type === AST_NODE_TYPES.ConditionalExpression
          ? [child.consequent, child.alternate]
          : [child.left, child.right];
      for (const branch of branches) visit(branch, depth + 1);
      return;
    }
    if (child.type === AST_NODE_TYPES.CallExpression) {
      // `items.map(item => <ListItem />)` — the element is in the callback body.
      for (const argument of child.arguments) visit(argument, depth + 1);
      return;
    }
    if (
      child.type === AST_NODE_TYPES.ArrowFunctionExpression &&
      child.body.type !== AST_NODE_TYPES.BlockStatement
    ) {
      visit(child.body, depth + 1);
    }
  };

  for (const child of node.children) visit(child, 0);
  return found;
}

export const compositionRules = defineRule({
  meta: {
    id: 'composition-rules',
    description: 'Components must respect the design system composition rules.',
    defaultSeverity: 'error',
    fixability: 'none',
    rationale:
      'Nesting a component inside itself usually doubles padding, borders and elevation. It is a layout bug that looks almost deliberate.',
  },

  create(context: RuleContext) {
    const rules = (context.designSystem.compositionRules ?? []).filter(
      (rule) => rule.severity !== 'off',
    );
    const components = context.designSystem.components ?? {};

    // Definitions may also carry child constraints; treat them as rules too.
    const fromComponents: CompositionRule[] = Object.values(components).flatMap((definition) => {
      const hasConstraint =
        definition.allowedChildren !== undefined || definition.forbiddenChildren !== undefined;
      if (!hasConstraint) return [];

      return [
        {
          id: 'composition-rules',
          parent: definition.name,
          severity: 'error',
          ...(definition.allowedChildren === undefined
            ? {}
            : { allowedChildren: definition.allowedChildren }),
          ...(definition.forbiddenChildren === undefined
            ? {}
            : { forbiddenChildren: definition.forbiddenChildren }),
        },
      ];
    });

    const all: CompositionRule[] = [...rules, ...fromComponents];
    if (all.length === 0) return {};

    return {
      jsxElement(node, ancestors) {
        const name = jsxElementName(node.openingElement);
        if (name === null) return;

        const ancestorNames = jsxAncestorNames(ancestors);

        // Descendant constraints are checked from the inner element looking up,
        // so the violation lands on the offending nesting rather than on the
        // outer element the developer probably did not touch.
        for (const rule of all) {
          if (rule.forbiddenDescendants?.includes(name) !== true) continue;
          if (!ancestorNames.includes(rule.parent)) continue;

          context.report({
            message:
              rule.message ??
              `\`${name}\` must not appear inside \`${rule.parent}\`. Nesting them duplicates padding, borders and elevation.`,
            range: [node.openingElement.range[0], node.openingElement.range[1]],
          });
        }

        const applicable = all.filter((rule) => rule.parent === name);
        if (applicable.length === 0) return;

        const children = directChildElements(node);

        for (const rule of applicable) {
          for (const child of children) {
            const childName = jsxElementName(child.openingElement);
            if (childName === null) continue;

            if (rule.forbiddenChildren?.includes(childName) === true) {
              context.report({
                message:
                  rule.message ??
                  `\`${childName}\` is not allowed as a direct child of \`${name}\`.`,
                range: [child.openingElement.range[0], child.openingElement.range[1]],
              });
              continue;
            }

            if (rule.allowedChildren !== undefined && !rule.allowedChildren.includes(childName)) {
              const list = rule.allowedChildren.map((allowed) => `\`${allowed}\``).join(', ');
              context.report({
                message:
                  rule.message ??
                  `\`${name}\` accepts only ${list} as direct children, but found \`${childName}\`.`,
                range: [child.openingElement.range[0], child.openingElement.range[1]],
              });
            }
          }
        }
      },
    };
  },
});
