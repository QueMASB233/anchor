/**
 * Component variant extraction from `class-variance-authority`.
 *
 * This is what makes `valid-component-variants` and `composition-rules` work
 * without a team hand-writing an inventory first. shadcn/ui and most modern
 * design systems already declare their variants in CVA, so Anchor reads them
 * from the source that is already the truth.
 *
 * Static only, like everything else that touches the target repo: the variant
 * object is read from the AST, never evaluated. A dynamically built variant map
 * is skipped rather than guessed at.
 *
 * Config always wins over anything extracted here — see
 * `mergeComponentInventories`.
 */

import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/typescript-estree';

import type { ComponentDefinition, ComponentInventory } from '../model/index.js';
import type { SourceFile } from '../engine/source-file.js';
import { walk } from '../engine/walker.js';

/** Functions that declare a variant map with CVA's shape. */
const VARIANT_FACTORIES = new Set(['cva', 'tv', 'cn', 'variants']);

export interface CvaExtractionOptions {
  /** Overrides the recognized factory names. */
  factories?: readonly string[];
  /**
   * Maps a variable name to a component name. Defaults to capitalizing and
   * stripping a `Variants`/`Styles` suffix, which matches the usual convention.
   */
  componentNameFor?: (variableName: string) => string;
}

function defaultComponentName(variableName: string): string {
  const stripped = variableName.replace(/(Variants|Styles|Classes|Css)$/u, '');
  const base = stripped === '' ? variableName : stripped;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function calleeName(node: TSESTree.CallExpression): string | null {
  if (node.callee.type === AST_NODE_TYPES.Identifier) return node.callee.name;
  if (
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    node.callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return node.callee.property.name;
  }
  return null;
}

function propertyName(property: TSESTree.Property): string | null {
  if (property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  if (property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string') {
    return property.key.value;
  }
  return null;
}

function findProperty(node: TSESTree.ObjectExpression, name: string): TSESTree.Property | null {
  for (const property of node.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    if (propertyName(property) === name) return property;
  }
  return null;
}

/**
 * Reads `{ variant: { primary: '...', ghost: '...' } }` into
 * `{ variant: ['primary', 'ghost'] }`.
 *
 * The keys are the whole point; the class strings they map to are linted
 * separately by the class-name extractor.
 */
function readVariantMap(node: TSESTree.ObjectExpression): Record<string, string[]> {
  const variants: Record<string, string[]> = {};

  for (const dimension of node.properties) {
    if (dimension.type !== AST_NODE_TYPES.Property) continue;

    const name = propertyName(dimension);
    if (name === null) continue;
    if (dimension.value.type !== AST_NODE_TYPES.ObjectExpression) continue;

    const values: string[] = [];
    for (const value of dimension.value.properties) {
      if (value.type !== AST_NODE_TYPES.Property) continue;
      const valueName = propertyName(value);
      // A boolean variant is declared as `{ true: '...', false: '...' }`.
      if (valueName !== null) values.push(valueName);
    }

    if (values.length > 0) variants[name] = values;
  }

  return variants;
}

/**
 * Extracts component definitions from every CVA call in a file.
 *
 * Only calls bound to a variable are extracted, since an anonymous call gives
 * no name to attach the definition to.
 */
export function extractCvaComponents(
  file: SourceFile,
  options: CvaExtractionOptions = {},
): ComponentInventory {
  const factories = new Set(options.factories ?? VARIANT_FACTORIES);
  const nameFor = options.componentNameFor ?? defaultComponentName;
  const inventory: ComponentInventory = {};

  walk(file.ast, (node) => {
    if (node.type !== AST_NODE_TYPES.VariableDeclarator) return;
    if (node.id.type !== AST_NODE_TYPES.Identifier) return;

    const init = node.init;
    if (init === null || init.type !== AST_NODE_TYPES.CallExpression) return;

    const factory = calleeName(init);
    if (factory === null || !factories.has(factory)) return;

    // CVA's signature is `cva(base, config)`; the variant map is in the config.
    const config = init.arguments.find(
      (argument): argument is TSESTree.ObjectExpression =>
        argument.type === AST_NODE_TYPES.ObjectExpression,
    );
    if (config === undefined) return;

    const variantsProperty = findProperty(config, 'variants');
    if (variantsProperty === null) return;
    if (variantsProperty.value.type !== AST_NODE_TYPES.ObjectExpression) return;

    const variants = readVariantMap(variantsProperty.value);
    if (Object.keys(variants).length === 0) return;

    const componentName = nameFor(node.id.name);
    const position = file.positionAt(node.range[0]);

    const definition: ComponentDefinition = {
      name: componentName,
      variants,
      // CVA variants all have fallbacks, so none of them is required. Required
      // props are a config-only concept.
      requiredProps: [],
      source: 'cva',
      provenance: { file: file.path, path: `${node.id.name} (line ${position.line})` },
    };

    inventory[componentName] = definition;
  });

  return inventory;
}
