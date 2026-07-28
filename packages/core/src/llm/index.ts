/**
 * The optional bring-your-own-key LLM layer.
 *
 * Nothing on the deterministic lint path imports this module. Anchor's core
 * promise — offline, free, no code transmitted — depends on that separation
 * being structural rather than a matter of discipline.
 */

export * from './adapters/index.js';
export * from './redact.js';
export * from './suggest.js';
export * from './types.js';
