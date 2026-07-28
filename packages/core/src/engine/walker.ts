/**
 * AST traversal.
 *
 * A hand-rolled generic walk rather than a visitor table, because Anchor needs
 * to work across every ESTree and TypeScript node type without enumerating
 * ~180 of them, and needs the ancestor chain — composition rules are entirely
 * about what a node sits inside.
 */

import type { TSESTree } from '@typescript-eslint/typescript-estree';

export type NodeVisitor = (node: TSESTree.Node, ancestors: readonly TSESTree.Node[]) => void;

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Visits every node depth-first, in source order, passing the ancestor chain
 * from outermost to innermost.
 *
 * `parent` links are skipped: typescript-estree does not set them by default,
 * but following one would turn the walk into an infinite loop if it did.
 */
export function walk(root: TSESTree.Node, visit: NodeVisitor): void {
  const ancestors: TSESTree.Node[] = [];

  const visitNode = (node: TSESTree.Node): void => {
    visit(node, ancestors);
    ancestors.push(node);

    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) visitNode(item);
        }
      } else if (isNode(value)) {
        visitNode(value);
      }
    }

    ancestors.pop();
  };

  visitNode(root);
}

/** Nearest ancestor matching `type`, searching from the innermost outwards. */
export function closest<T extends TSESTree.Node['type']>(
  ancestors: readonly TSESTree.Node[],
  type: T,
): Extract<TSESTree.Node, { type: T }> | null {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (node?.type === type) return node as Extract<TSESTree.Node, { type: T }>;
  }
  return null;
}
