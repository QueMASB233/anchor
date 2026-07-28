/**
 * JSX helpers shared by the element-oriented rules.
 */

import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';

/**
 * The element's name as written: `div`, `Button`, `Card.Header`.
 *
 * Namespaced and member names are preserved verbatim so a design system can
 * declare rules about `Card.Header` without Anchor flattening it to `Header`.
 */
export function jsxElementName(node: TSESTree.JSXOpeningElement): string | null {
  const { name } = node;

  switch (name.type) {
    case AST_NODE_TYPES.JSXIdentifier:
      return name.name;
    case AST_NODE_TYPES.JSXMemberExpression: {
      const parts: string[] = [];
      let current: TSESTree.JSXTagNameExpression = name;
      while (current.type === AST_NODE_TYPES.JSXMemberExpression) {
        parts.unshift(current.property.name);
        current = current.object;
      }
      if (current.type === AST_NODE_TYPES.JSXIdentifier) parts.unshift(current.name);
      return parts.join('.');
    }
    case AST_NODE_TYPES.JSXNamespacedName:
      return `${name.namespace.name}:${name.name.name}`;
    default:
      return null;
  }
}

/** True when the tag names a component rather than an intrinsic HTML element. */
export function isComponentName(name: string): boolean {
  const first = name[0];
  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase();
}

export interface JsxAttributeInfo {
  name: string;
  node: TSESTree.JSXAttribute;
  /** The value when it is a static string, else `null`. */
  value: string | null;
  valueNode: TSESTree.Node | null;
}

/** Reads an attribute's value when it can be known without executing code. */
function staticAttributeValue(node: TSESTree.JSXAttribute): {
  value: string | null;
  valueNode: TSESTree.Node | null;
} {
  const { value } = node;
  if (value === null) return { value: null, valueNode: null };

  if (value.type === AST_NODE_TYPES.Literal) {
    return {
      value: typeof value.value === 'string' ? value.value : null,
      valueNode: value,
    };
  }

  if (value.type === AST_NODE_TYPES.JSXExpressionContainer) {
    const expression = value.expression;
    if (expression.type === AST_NODE_TYPES.Literal && typeof expression.value === 'string') {
      return { value: expression.value, valueNode: expression };
    }
    if (
      expression.type === AST_NODE_TYPES.TemplateLiteral &&
      expression.expressions.length === 0 &&
      expression.quasis[0] !== undefined
    ) {
      return { value: expression.quasis[0].value.cooked, valueNode: expression };
    }
    return { value: null, valueNode: expression };
  }

  return { value: null, valueNode: null };
}

/** Every named attribute on an element. Spread attributes are not enumerable. */
export function jsxAttributes(node: TSESTree.JSXOpeningElement): JsxAttributeInfo[] {
  const attributes: JsxAttributeInfo[] = [];

  for (const attribute of node.attributes) {
    if (attribute.type !== AST_NODE_TYPES.JSXAttribute) continue;
    if (attribute.name.type !== AST_NODE_TYPES.JSXIdentifier) continue;

    const { value, valueNode } = staticAttributeValue(attribute);
    attributes.push({ name: attribute.name.name, node: attribute, value, valueNode });
  }

  return attributes;
}

/** True when the element spreads props, so its full prop set is unknowable. */
export function hasSpreadAttributes(node: TSESTree.JSXOpeningElement): boolean {
  return node.attributes.some((attribute) => attribute.type === AST_NODE_TYPES.JSXSpreadAttribute);
}

/** Names of the JSX elements enclosing a node, outermost first. */
export function jsxAncestorNames(ancestors: readonly TSESTree.Node[]): string[] {
  const names: string[] = [];
  for (const ancestor of ancestors) {
    if (ancestor.type !== AST_NODE_TYPES.JSXElement) continue;
    const name = jsxElementName(ancestor.openingElement);
    if (name !== null) names.push(name);
  }
  return names;
}
