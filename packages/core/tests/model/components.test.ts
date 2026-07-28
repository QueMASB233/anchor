import { describe, expect, it } from 'vitest';

import {
  allowedVariantValues,
  ComponentDefinitionSchema,
  CompositionRuleSchema,
  mergeComponentInventories,
  type ComponentDefinition,
  type ComponentInventory,
} from '../../src/model/components.js';

const button: ComponentDefinition = {
  name: 'Button',
  variants: { variant: ['primary', 'secondary', 'ghost'], size: ['sm', 'md', 'lg'] },
  requiredProps: [],
  source: 'cva',
};

describe('ComponentDefinitionSchema', () => {
  it('treats size as just another variant dimension', () => {
    const parsed = ComponentDefinitionSchema.parse(button);
    expect(parsed.variants['size']).toEqual(['sm', 'md', 'lg']);
  });

  it('accepts team-specific dimensions without a schema change', () => {
    const result = ComponentDefinitionSchema.safeParse({
      ...button,
      variants: { ...button.variants, tone: ['neutral', 'danger'] },
    });
    expect(result.success).toBe(true);
  });

  it('distinguishes an empty allowedChildren from an absent one', () => {
    const noChildren = ComponentDefinitionSchema.parse({ ...button, allowedChildren: [] });
    expect(noChildren.allowedChildren).toEqual([]);

    const unrestricted = ComponentDefinitionSchema.parse(button);
    expect(unrestricted.allowedChildren).toBeUndefined();
  });

  it('rejects an unknown source', () => {
    expect(ComponentDefinitionSchema.safeParse({ ...button, source: 'magic' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ComponentDefinitionSchema.safeParse({ ...button, slots: ['icon'] }).success).toBe(false);
  });
});

describe('allowedVariantValues', () => {
  const definition = ComponentDefinitionSchema.parse(button);

  it('returns the declared values for a known dimension', () => {
    expect(allowedVariantValues(definition, 'variant')).toEqual(['primary', 'secondary', 'ghost']);
  });

  it('returns null for an undeclared dimension, which is not the same as no values', () => {
    expect(allowedVariantValues(definition, 'tone')).toBeNull();
  });
});

describe('mergeComponentInventories', () => {
  const fromCva: ComponentInventory = {
    Button: { ...button, variants: { variant: ['primary'] }, source: 'cva' },
    Card: { name: 'Card', variants: {}, requiredProps: [], source: 'cva' },
  };
  const fromConfig: ComponentInventory = {
    Button: {
      name: 'Button',
      variants: { variant: ['primary', 'secondary'] },
      requiredProps: ['children'],
      source: 'config',
    },
  };

  it('lets a later source win per component', () => {
    const merged = mergeComponentInventories(fromCva, fromConfig);
    expect(merged['Button']?.source).toBe('config');
    expect(merged['Button']?.variants['variant']).toEqual(['primary', 'secondary']);
  });

  it('replaces a definition wholesale rather than deep-merging its variants', () => {
    // A half-CVA, half-config variant map would be impossible for a user to
    // reason about when a violation fires, so config's map must stand alone.
    const merged = mergeComponentInventories(fromCva, fromConfig);
    expect(merged['Button']?.requiredProps).toEqual(['children']);
    expect(Object.keys(merged['Button']?.variants ?? {})).toEqual(['variant']);
  });

  it('keeps components only present in the earlier source', () => {
    expect(mergeComponentInventories(fromCva, fromConfig)['Card']?.source).toBe('cva');
  });

  it('returns an empty inventory when given nothing', () => {
    expect(mergeComponentInventories()).toEqual({});
  });
});

describe('CompositionRuleSchema', () => {
  it('models Card-in-Card as a descendant constraint', () => {
    const rule = CompositionRuleSchema.parse({
      id: 'no-nested-card',
      parent: 'Card',
      forbiddenDescendants: ['Card'],
      severity: 'error',
    });
    expect(rule.forbiddenDescendants).toEqual(['Card']);
    expect(rule.forbiddenChildren).toBeUndefined();
  });

  it('models a direct-child allowlist separately from descendants', () => {
    const rule = CompositionRuleSchema.parse({
      id: 'list-children',
      parent: 'List',
      allowedChildren: ['ListItem'],
      severity: 'error',
    });
    expect(rule.allowedChildren).toEqual(['ListItem']);
  });

  it('allows a rule to be switched off without being deleted', () => {
    expect(
      CompositionRuleSchema.safeParse({ id: 'x', parent: 'Card', severity: 'off' }).success,
    ).toBe(true);
  });

  it('requires an id, since violations reference it', () => {
    expect(CompositionRuleSchema.safeParse({ parent: 'Card', severity: 'error' }).success).toBe(
      false,
    );
  });
});
