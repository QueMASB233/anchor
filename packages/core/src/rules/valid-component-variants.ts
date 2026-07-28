/**
 * valid-component-variants — flags `<Button variant="primarry">`.
 *
 * A typo'd variant is uniquely nasty: nothing errors, nothing warns, the
 * component silently falls back to its default styling, and the bug is only
 * visible to someone who knows what it should have looked like.
 *
 * The rule stays silent about components it has no declaration for. Guessing
 * that an undeclared prop is invalid would flag every component Anchor has not
 * been told about, which is the fastest possible way to be turned off.
 */

import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

import { jsxAttributes, jsxElementName } from '../engine/jsx.js';
import { defineRule, type RuleContext } from './rule.js';

/** Levenshtein distance, capped — used only to name a likely intended value. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_unused, index) => index);

  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1);
      const insertion = (current[column - 1] ?? 0) + 1;
      const deletion = (previous[column] ?? 0) + 1;
      current[column] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[columns - 1] ?? Number.POSITIVE_INFINITY;
}

/** The closest allowed value, when one is close enough to be worth naming. */
function closestValue(used: string, allowed: readonly string[]): string | null {
  let best: { value: string; distance: number } | null = null;

  for (const value of allowed) {
    const distance = editDistance(used.toLowerCase(), value.toLowerCase());
    if (best === null || distance < best.distance) best = { value, distance };
  }

  // Beyond a third of the string being wrong it is a different word, not a typo.
  const threshold = Math.max(1, Math.floor(used.length / 3));
  return best !== null && best.distance <= threshold ? best.value : null;
}

export const validComponentVariants = defineRule({
  meta: {
    id: 'valid-component-variants',
    description: 'Component variant props must use a declared value.',
    defaultSeverity: 'error',
    fixability: 'auto',
    rationale:
      'An unrecognized variant does not fail loudly. The component falls back to its default and the mistake ships looking almost right.',
  },

  create(context: RuleContext) {
    const components = context.designSystem.components;
    if (components === undefined || Object.keys(components).length === 0) return {};

    return {
      jsxElement(node) {
        const name = jsxElementName(node.openingElement);
        if (name === null) return;

        const definition = components[name];
        if (definition === undefined) return;

        const attributes = jsxAttributes(node.openingElement);
        const present = new Set(attributes.map((attribute) => attribute.name));

        for (const attribute of attributes) {
          const allowed = definition.variants[attribute.name];
          if (allowed === undefined || allowed.length === 0) continue;

          // A non-literal value cannot be checked without running the code.
          if (attribute.value === null) continue;
          if (allowed.includes(attribute.value)) continue;

          const valueNode = attribute.valueNode;
          const suggestion = closestValue(attribute.value, allowed);
          const list = allowed.map((value) => `\`${value}\``).join(', ');
          const hint = suggestion === null ? '' : ` Did you mean \`${suggestion}\`?`;

          // Replace only the string contents, leaving the quotes in place.
          const fixRange: [number, number] | null =
            valueNode !== null && valueNode.type === AST_NODE_TYPES.Literal
              ? [valueNode.range[0] + 1, valueNode.range[1] - 1]
              : null;

          context.report({
            message: `\`${name}\` has no \`${attribute.name}\` variant called \`${attribute.value}\`. Allowed: ${list}.${hint}`,
            range: [attribute.node.range[0], attribute.node.range[1]],
            ...(suggestion === null ? {} : { suggestedFix: suggestion }),
            ...(suggestion !== null && fixRange !== null
              ? { fix: { range: fixRange, text: suggestion } }
              : {}),
          });
        }

        for (const required of definition.requiredProps) {
          if (present.has(required)) continue;
          // `children` is satisfied by element content, not by a prop.
          if (required === 'children' && node.children.length > 0) continue;

          context.report({
            message: `\`${name}\` requires the \`${required}\` prop.`,
            range: [node.openingElement.range[0], node.openingElement.range[1]],
          });
        }
      },
    };
  },
});
