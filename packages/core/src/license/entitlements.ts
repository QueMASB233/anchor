/**
 * The single gate every future paid capability must pass through.
 *
 * TODAY THIS GATES NOTHING. `getEntitlements()` returns the same feature set
 * whether or not a license is present, because every capability Anchor ships
 * is free. That is deliberate, and the tests assert it: a seam that silently
 * started gating things would be a betrayal of the OSS promise, not a feature.
 *
 * WHY IT EXISTS ANYWAY
 * --------------------
 * Retrofitting entitlement checks into a codebase is where products acquire
 * their worst bugs — a check missed in one code path, a different check in
 * another, and eventually a customer who paid and cannot use what they bought.
 * One function, called from one place per capability, is cheap to add now and
 * expensive to add later.
 *
 * THE RULE FOR FUTURE CONTRIBUTORS
 * --------------------------------
 * If a capability is ever gated, it is gated by asking this function, and by
 * nothing else. No `if (license)` anywhere. No tier checks scattered through
 * rules. See docs/PAID-TIER.md for what is planned and, just as importantly,
 * what is promised to stay free forever.
 */

import { verifyLicense, type LicenseInfo, type LicenseTier } from './verify.js';

/**
 * Every capability Anchor knows about.
 *
 * All of them are currently in {@link FREE_FEATURES}. The type exists so that
 * a future paid capability is a compile-time addition rather than a string
 * typo waiting to happen.
 */
export const FEATURES = [
  'lint',
  'sync',
  'all-builtin-rules',
  'all-token-formats',
  'github-action',
  'sarif-output',
  'llm-suggestions',
  'custom-anti-patterns',
] as const;

export type Feature = (typeof FEATURES)[number];

/**
 * What the free tier includes: everything.
 *
 * Anything added to this list is a promise. Removing an entry from it would be
 * taking away a capability users already have, which is not something a
 * licence change should ever do — see the compatibility note in
 * docs/PAID-TIER.md.
 */
export const FREE_FEATURES: readonly Feature[] = [...FEATURES];

export interface Entitlements {
  tier: LicenseTier;
  /** Seat count from the license, or `null` when unlimited or unlicensed. */
  seats: number | null;
  /** The verified license, when one was supplied and accepted. */
  license: LicenseInfo | null;
  /**
   * Set when a license key was supplied but not accepted. Surfaced by the CLI
   * so a paying customer is told why, rather than silently getting less.
   */
  problem?: string;
  /** Capabilities available to this caller. */
  features: ReadonlySet<Feature>;
}

export interface EntitlementsOptions {
  /** License key from `anchor.config`. */
  licenseKey?: string | undefined;
  /** Environment, consulted for `ANCHOR_LICENSE_KEY`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Public key override. Tests only; production callers pass nothing. */
  publicKey?: string;
  now?: Date;
}

/**
 * Resolves what the current caller is entitled to.
 *
 * Resolution order is config, then environment — matching how every other
 * setting behaves, so there is one rule to remember.
 */
export function getEntitlements(options: EntitlementsOptions = {}): Entitlements {
  const key = options.licenseKey ?? options.env?.['ANCHOR_LICENSE_KEY'] ?? '';

  // The free tier is the floor, and today it is also the ceiling.
  const base: Entitlements = {
    tier: 'free',
    seats: null,
    license: null,
    features: new Set(FREE_FEATURES),
  };

  if (key.trim() === '') return base;

  const result = verifyLicense(key, {
    ...(options.publicKey === undefined ? {} : { publicKey: options.publicKey }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  if (!result.valid) {
    // An unusable license never costs a user anything they already had.
    return { ...base, problem: result.message };
  }

  return {
    tier: result.license.tier,
    seats: result.license.seats,
    license: result.license,
    // Unchanged on purpose. When a paid capability exists, it is added here,
    // and only here.
    features: new Set(FREE_FEATURES),
  };
}

/**
 * Whether a capability is available.
 *
 * The only function a future paid feature should consult. It currently returns
 * `true` for everything, which is exactly right.
 */
export function hasFeature(entitlements: Entitlements, feature: Feature): boolean {
  return entitlements.features.has(feature);
}

/** A one-line description for CLI output. Says nothing when unlicensed. */
export function describeEntitlements(entitlements: Entitlements): string | null {
  if (entitlements.license === null) return null;

  const seats = entitlements.seats === null ? 'unlimited seats' : `${entitlements.seats} seats`;
  const expiry =
    entitlements.license.expiresAt === null
      ? 'perpetual'
      : `through ${entitlements.license.expiresAt.slice(0, 10)}`;

  return `${entitlements.tier} license · ${entitlements.license.organization} · ${seats} · ${expiry}`;
}
