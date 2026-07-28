/**
 * Re-exports the model schemas and zod itself from core.
 *
 * The CLI validates config against the same schemas the model uses, so the two
 * cannot drift: a component declared in `anchor.config` is checked by exactly
 * the schema the rules will read it through.
 */

export { z } from 'zod';
export {
  AntiPatternSchema,
  ComponentDefinitionSchema,
  CompositionRuleSchema,
  RULE_IDS,
  SeveritySchema,
} from '@eleva/anchor-core';
