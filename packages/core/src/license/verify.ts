/**
 * Offline license verification.
 *
 * A license is a signed statement of fact — "this organization holds a team
 * license for 25 seats until this date" — that Anchor can check on a laptop
 * with no network, in an air-gapped CI runner, and in ten years when whatever
 * billing system issued it no longer exists.
 *
 * WHY ED25519 AND NO SERVER
 * -------------------------
 * A licence check that phones home would contradict Anchor's central promise.
 * Signature verification needs only a public key, so the check costs nothing,
 * leaks nothing, and cannot be taken down. The private key that issues licenses
 * never enters this repository, CI, or any published artifact.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It establishes *entitlement*, not enforcement. Anchor is open source: anyone
 * can delete the check and rebuild. That is an accepted trade-off, stated
 * plainly in SECURITY.md, and the reason the paid tier's value has to come from
 * things a patched binary does not get — hosted rule packs, support, an audit
 * trail — rather than from a flag this function returns.
 *
 * NOTHING IS GATED TODAY. Every capability Anchor ships is free. This module
 * exists so that adding a paid tier later is an addition rather than a
 * refactor. See docs/PAID-TIER.md for the intended design.
 */

import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

export const LICENSE_TIERS = ['free', 'team', 'enterprise'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

export interface LicenseInfo {
  /** Format version, so the payload can evolve without breaking old clients. */
  version: number;
  tier: Exclude<LicenseTier, 'free'>;
  /** Who the license was issued to. Shown in `anchor lint` output. */
  organization: string;
  /** Seat count, or `null` for an unlimited license. */
  seats: number | null;
  /** ISO timestamp the license was issued. */
  issuedAt: string;
  /** ISO timestamp it stops being valid, or `null` for perpetual. */
  expiresAt: string | null;
  /** Stable identifier, for support and for a future revocation list. */
  id: string;
  /** Named capabilities this license unlocks. Empty until a paid tier exists. */
  features: string[];
}

/** Why a license key was not accepted. Distinguishable so the CLI can advise. */
export type LicenseFailure =
  'malformed' | 'bad-signature' | 'expired' | 'unsupported-version' | 'invalid-payload';

export type LicenseResult =
  | { valid: true; license: LicenseInfo }
  | { valid: false; failure: LicenseFailure; message: string };

/**
 * PLACEHOLDER — NOT A REAL SIGNING KEY.
 *
 * Replace with Eleva Builds' production Ed25519 public key (base64 SPKI DER)
 * before any license is ever issued. Until then no key verifies against it,
 * which is the correct behaviour: a build that cannot verify anything cannot
 * accidentally honour a forged license.
 *
 * The matching PRIVATE key must never appear in this repository, in CI, or in
 * a published artifact. It belongs on offline signing infrastructure.
 */
export const PRODUCTION_PUBLIC_KEY_SPKI_B64 =
  'PLACEHOLDER_REPLACE_WITH_PRODUCTION_ED25519_PUBLIC_KEY';

/** Prefix and format version, so a key is recognizable on sight. */
const KEY_PREFIX = 'ANCHOR';
const SUPPORTED_VERSION = 1;

/** Builds a `KeyObject` from base64 SPKI DER, or `null` if it is not one. */
export function publicKeyFrom(spkiBase64: string): KeyObject | null {
  try {
    return createPublicKey({
      key: Buffer.from(spkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function encodeBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Shape of the signed payload, before it is trusted. */
interface RawPayload {
  v?: unknown;
  tier?: unknown;
  org?: unknown;
  seats?: unknown;
  iat?: unknown;
  exp?: unknown;
  id?: unknown;
  features?: unknown;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Validates the decoded payload. Runs only after the signature has passed. */
function readPayload(raw: RawPayload): LicenseInfo | null {
  if (raw.v !== SUPPORTED_VERSION) return null;
  if (raw.tier !== 'team' && raw.tier !== 'enterprise') return null;
  if (typeof raw.org !== 'string' || raw.org === '') return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (!isIsoDate(raw.iat)) return null;

  const seats = raw.seats === null || raw.seats === undefined ? null : raw.seats;
  if (seats !== null && (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 1)) {
    return null;
  }

  const expiresAt = raw.exp === null || raw.exp === undefined ? null : raw.exp;
  if (expiresAt !== null && !isIsoDate(expiresAt)) return null;

  const features =
    raw.features === undefined
      ? []
      : Array.isArray(raw.features) && raw.features.every((f) => typeof f === 'string')
        ? raw.features
        : null;
  if (features === null) return null;

  return {
    version: SUPPORTED_VERSION,
    tier: raw.tier,
    organization: raw.org,
    seats,
    issuedAt: raw.iat,
    expiresAt,
    id: raw.id,
    features,
  };
}

export interface VerifyOptions {
  /**
   * Public key to verify against, as base64 SPKI DER.
   *
   * Exists so the test suite can verify a genuinely signed key without the
   * production private key being anywhere near this repository. Production
   * callers pass nothing.
   */
  publicKey?: string;
  /** Clock override, so expiry is testable without waiting. */
  now?: Date;
}

/**
 * Verifies a license key.
 *
 * The signature is checked *before* the payload is interpreted, so malformed
 * or hostile content never reaches the parsing logic.
 *
 * Returns a structured failure rather than throwing: an invalid license is an
 * ordinary condition that should degrade to the free tier, never crash a lint
 * run.
 */
export function verifyLicense(key: string, options: VerifyOptions = {}): LicenseResult {
  const trimmed = key.trim();

  const parts = trimmed.split('-');
  if (parts.length < 3 || parts[0] !== KEY_PREFIX) {
    return {
      valid: false,
      failure: 'malformed',
      message: `A license key looks like \`${KEY_PREFIX}-1-<payload>.<signature>\`.`,
    };
  }

  const version = Number(parts[1]);
  if (!Number.isInteger(version)) {
    return { valid: false, failure: 'malformed', message: 'The license key has no version.' };
  }
  if (version !== SUPPORTED_VERSION) {
    return {
      valid: false,
      failure: 'unsupported-version',
      message: `This license is format version ${version}, and this build of Anchor understands version ${SUPPORTED_VERSION}. Upgrade Anchor.`,
    };
  }

  // The body may itself contain `-` from base64url, so rejoin everything after
  // the version rather than assuming exactly three segments.
  const body = parts.slice(2).join('-');
  const [payloadPart, signaturePart, ...rest] = body.split('.');

  if (payloadPart === undefined || signaturePart === undefined || rest.length > 0) {
    return {
      valid: false,
      failure: 'malformed',
      message: 'The license key is missing its payload or signature.',
    };
  }

  const publicKey = publicKeyFrom(options.publicKey ?? PRODUCTION_PUBLIC_KEY_SPKI_B64);
  if (publicKey === null) {
    return {
      valid: false,
      failure: 'bad-signature',
      message:
        'This build of Anchor has no license public key compiled in, so no license can be verified. Every feature is free regardless.',
    };
  }

  let signatureValid = false;
  try {
    signatureValid = verifySignature(
      null,
      Buffer.from(payloadPart, 'utf8'),
      publicKey,
      decodeBase64Url(signaturePart),
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return {
      valid: false,
      failure: 'bad-signature',
      message: 'This license key’s signature does not verify. Check it was copied in full.',
    };
  }

  let raw: RawPayload;
  try {
    raw = JSON.parse(decodeBase64Url(payloadPart).toString('utf8')) as RawPayload;
  } catch {
    return {
      valid: false,
      failure: 'invalid-payload',
      message: 'The license payload is signed but is not readable JSON.',
    };
  }

  const license = readPayload(raw);
  if (license === null) {
    return {
      valid: false,
      failure: 'invalid-payload',
      message:
        'The license payload is signed but does not describe a license this build understands.',
    };
  }

  const now = options.now ?? new Date();
  if (license.expiresAt !== null && Date.parse(license.expiresAt) < now.getTime()) {
    return {
      valid: false,
      failure: 'expired',
      message: `This license expired on ${license.expiresAt.slice(0, 10)}. Anchor continues to work; every feature is free.`,
    };
  }

  return { valid: true, license };
}

/**
 * Builds the signable form of a payload.
 *
 * Exported so the signing tool and the verifier cannot disagree about what
 * bytes are covered by the signature — the classic way signature schemes break.
 */
export function encodeLicensePayload(payload: Record<string, unknown>): string {
  return encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
}

/** Assembles a key from an already-signed payload. Used by tests and tooling. */
export function formatLicenseKey(encodedPayload: string, signature: Buffer): string {
  return `${KEY_PREFIX}-${SUPPORTED_VERSION}-${encodedPayload}.${encodeBase64Url(signature)}`;
}
