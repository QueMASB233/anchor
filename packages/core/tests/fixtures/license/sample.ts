/**
 * A pre-signed sample license, for verifying the key format never changes
 * silently.
 *
 * NO PRIVATE KEY LIVES HERE, OR ANYWHERE IN THIS REPOSITORY.
 *
 * A signed license is a public artifact — it is a statement anyone may read
 * and nobody but the key holder may forge — so committing one is safe. The
 * matching private key was generated for this fixture, used once to produce the
 * string below, and never written to disk. It is not Eleva Builds' production
 * signing key, which does not exist yet and will live on offline
 * infrastructure when it does.
 *
 * Round-trip behaviour is covered separately by tests that generate a fresh
 * keypair at runtime. This fixture exists for one narrow purpose: if someone
 * changes the payload encoding, the prefix, or the signed byte range, this key
 * stops verifying and the test says so.
 */

/** Base64 SPKI DER of the fixture's public key. Safe to publish. */
export const FIXTURE_PUBLIC_KEY = 'MCowBQYDK2VwAyEA0XWza6mqKyWrN9k6jfyFvXPmCGxcqEGnplfar/53DRg=';

/** A valid enterprise license signed by {@link FIXTURE_PUBLIC_KEY}. */
export const FIXTURE_LICENSE_KEY =
  'ANCHOR-1-eyJ2IjoxLCJ0aWVyIjoiZW50ZXJwcmlzZSIsIm9yZyI6IkZpeHR1cmUgT3JnIiwic2VhdHMiOjI1LCJpYXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJleHAiOiIyMDk5LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6ImxpY19maXh0dXJlXzAwMDEiLCJmZWF0dXJlcyI6W119.erNP99BTSrmdLVYvPyoXTagbHZGDeEqh3yDcWBPkWaapeh8r7t5yKEVqnIIi722lopy25H9E85sfuWrT1UTTCw';

/** What the fixture key decodes to, once verified. */
export const FIXTURE_LICENSE = {
  version: 1,
  tier: 'enterprise',
  organization: 'Fixture Org',
  seats: 25,
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  id: 'lic_fixture_0001',
  features: [] as string[],
} as const;
