/**
 * Component inventory and composition rules.
 *
 * Unlike tokens, this half of the model cannot be read from a token file — no
 * token format carries "Button accepts variant=primary|secondary". It is
 * assembled from two sources: entries declared in `anchor.config`, and variants
 * statically extracted from `class-variance-authority` definitions in the
 * team's own component source. Config always wins, since it is the explicit
 * statement of intent.
 */

import { z } from 'zod';

import { ProvenanceSchema, SeveritySchema } from './common.js';

/** Where a component definition came from. Config outranks extraction. */
export const ComponentSourceSchema = z.enum(['config', 'cva', 'inferred']);
export type ComponentSource = z.infer<typeof ComponentSourceSchema>;

/**
 * A component's public contract, as far as Anchor can enforce it.
 *
 * `variants` is a flat map of dimension to allowed values, which covers `size`
 * as just another dimension rather than modelling it separately. That matches
 * how CVA and every modern variant library actually work, and means a team can
 * add a `tone` or `density` dimension without a change to Anchor.
 */
export const ComponentDefinitionSchema = z.strictObject({
  /** The JSX element name, e.g. `Button`. Matched case-sensitively. */
  name: z.string().min(1),
  description: z.string().optional(),
  /** Variant dimension -> the values it accepts, e.g. `{ variant: ['primary'] }`. */
  variants: z.record(z.string(), z.array(z.string())),
  /** Props that must be present on every usage. */
  requiredProps: z.array(z.string()),
  /**
   * Component names allowed as direct children. `undefined` means unrestricted;
   * an empty array means the component must not have element children at all.
   */
  allowedChildren: z.array(z.string()).optional(),
  /** Component names never allowed as direct children. */
  forbiddenChildren: z.array(z.string()).optional(),
  source: ComponentSourceSchema,
  provenance: ProvenanceSchema.optional(),
});
export type ComponentDefinition = z.infer<typeof ComponentDefinitionSchema>;

/** Component name -> definition. */
export const ComponentInventorySchema = z.record(z.string(), ComponentDefinitionSchema);
export type ComponentInventory = z.infer<typeof ComponentInventorySchema>;

/**
 * A structural constraint between components.
 *
 * The distinction between `forbiddenChildren` and `forbiddenDescendants` is
 * load-bearing: "a Card must not contain another Card" is a descendant rule
 * that has to survive arbitrary wrapper elements, whereas "a List accepts only
 * ListItem children" is strictly about direct children.
 */
export const CompositionRuleSchema = z.strictObject({
  /** Stable identifier, surfaced in violation messages and used for suppression. */
  id: z.string().min(1),
  /** The component this rule constrains. */
  parent: z.string().min(1),
  /** Components that must not appear anywhere beneath `parent`. */
  forbiddenDescendants: z.array(z.string()).optional(),
  /** Components that must not appear as direct children of `parent`. */
  forbiddenChildren: z.array(z.string()).optional(),
  /** When set, only these components may be direct children of `parent`. */
  allowedChildren: z.array(z.string()).optional(),
  severity: SeveritySchema,
  /** Overrides the generated message. Written for the developer who hits it. */
  message: z.string().optional(),
});
export type CompositionRule = z.infer<typeof CompositionRuleSchema>;

/**
 * Merges component definitions, with later sources overriding earlier ones on a
 * per-component basis.
 *
 * Deliberately a whole-definition replace rather than a deep merge: a partially
 * merged variant map — half from CVA, half from config — would be almost
 * impossible for a user to reason about when a violation fires.
 */
export function mergeComponentInventories(
  ...inventories: readonly ComponentInventory[]
): ComponentInventory {
  const merged: ComponentInventory = {};
  for (const inventory of inventories) {
    for (const [name, definition] of Object.entries(inventory)) {
      merged[name] = definition;
    }
  }
  return merged;
}

/** Looks up the values a variant dimension accepts, or `null` if undeclared. */
export function allowedVariantValues(
  definition: ComponentDefinition,
  dimension: string,
): string[] | null {
  return definition.variants[dimension] ?? null;
}
