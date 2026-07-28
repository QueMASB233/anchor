/**
 * @eleva/anchor-core — the deterministic heart of Anchor.
 *
 * This package has no CLI concerns and performs no network I/O in its default
 * path. It parses a team's design system into a normalized model, generates
 * AI-readable context files from it, and lints source code against it.
 *
 * Public surface is re-exported here and nowhere else; deep imports into
 * `dist/` internals are not supported and are not covered by semver.
 */

/** Semantic version of the core engine, surfaced in reports and cache keys. */
export const CORE_VERSION = '0.0.0';

export * from './model/index.js';
export * from './parsers/index.js';
