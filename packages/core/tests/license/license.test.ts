import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  describeEntitlements,
  FEATURES,
  FREE_FEATURES,
  getEntitlements,
  hasFeature,
} from '../../src/license/entitlements.js';
import {
  encodeBase64Url,
  encodeLicensePayload,
  formatLicenseKey,
  publicKeyFrom,
  PRODUCTION_PUBLIC_KEY_SPKI_B64,
  verifyLicense,
} from '../../src/license/verify.js';
import {
  FIXTURE_LICENSE,
  FIXTURE_LICENSE_KEY,
  FIXTURE_PUBLIC_KEY,
} from '../fixtures/license/sample.js';

/**
 * A signing authority created for the duration of a test.
 *
 * Generating rather than committing means the round-trip is exercised against
 * real Ed25519 and no private key exists in the repository for even a moment.
 */
function makeAuthority() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const issue = (payload: Record<string, unknown>): string => {
    const encoded = encodeLicensePayload(payload);
    return formatLicenseKey(encoded, sign(null, Buffer.from(encoded, 'utf8'), privateKey));
  };

  return { publicKey: spki, issue };
}

const validPayload = {
  v: 1,
  tier: 'team',
  org: 'Acme Inc',
  seats: 25,
  iat: '2026-01-01T00:00:00.000Z',
  exp: '2030-01-01T00:00:00.000Z',
  id: 'lic_0001',
  features: [],
};

describe('verifyLicense', () => {
  const authority = makeAuthority();

  it('accepts a genuinely signed key and reads its payload', () => {
    const result = verifyLicense(authority.issue(validPayload), {
      publicKey: authority.publicKey,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.license).toEqual({
        version: 1,
        tier: 'team',
        organization: 'Acme Inc',
        seats: 25,
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
        id: 'lic_0001',
        features: [],
      });
    }
  });

  it('accepts a perpetual, unlimited-seat license', () => {
    const key = authority.issue({ ...validPayload, seats: null, exp: null });
    const result = verifyLicense(key, { publicKey: authority.publicKey });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.license.seats).toBeNull();
      expect(result.license.expiresAt).toBeNull();
    }
  });

  describe('forgery', () => {
    it('rejects a payload edited after signing', () => {
      const key = authority.issue(validPayload);
      const [prefix, body] = [
        key.slice(0, key.indexOf('-', 7) + 1),
        key.slice(key.indexOf('-', 7) + 1),
      ];
      const [payload, signature] = body.split('.');

      // Grant the holder a thousand seats without re-signing.
      const tampered = encodeLicensePayload({ ...validPayload, seats: 1000 });
      const forged = `${prefix}${tampered}.${signature ?? ''}`;

      expect(payload).not.toBe(tampered);
      expect(verifyLicense(forged, { publicKey: authority.publicKey })).toMatchObject({
        valid: false,
        failure: 'bad-signature',
      });
    });

    it('rejects a key signed by a different authority', () => {
      const other = makeAuthority();
      const key = other.issue(validPayload);

      expect(verifyLicense(key, { publicKey: authority.publicKey })).toMatchObject({
        valid: false,
        failure: 'bad-signature',
      });
    });

    it('rejects a mangled signature', () => {
      const key = authority.issue(validPayload);
      const broken = `${key.slice(0, -4)}AAAA`;

      expect(verifyLicense(broken, { publicKey: authority.publicKey }).valid).toBe(false);
    });

    it('rejects an unsigned payload passed off as a key', () => {
      const payload = encodeLicensePayload(validPayload);
      const result = verifyLicense(`ANCHOR-1-${payload}.`, { publicKey: authority.publicKey });

      expect(result.valid).toBe(false);
    });
  });

  describe('malformed input', () => {
    it.each([
      ['empty', ''],
      ['no prefix', 'NOTANCHOR-1-abc.def'],
      ['no version', 'ANCHOR-x-abc.def'],
      ['no signature', 'ANCHOR-1-abconly'],
      ['too many segments', 'ANCHOR-1-a.b.c'],
      ['random text', 'hello world'],
    ])('rejects %s without throwing', (_label, key) => {
      expect(() => verifyLicense(key, { publicKey: authority.publicKey })).not.toThrow();
      expect(verifyLicense(key, { publicKey: authority.publicKey }).valid).toBe(false);
    });

    it('names the expected shape when a key is malformed', () => {
      const result = verifyLicense('nonsense', { publicKey: authority.publicKey });
      if (!result.valid) expect(result.message).toContain('ANCHOR-1-');
    });

    it('tolerates surrounding whitespace, since keys get copy-pasted', () => {
      const key = `\n  ${authority.issue(validPayload)}  \n`;
      expect(verifyLicense(key, { publicKey: authority.publicKey }).valid).toBe(true);
    });
  });

  describe('payload validation, which runs only after the signature passes', () => {
    it.each([
      ['an unknown tier', { ...validPayload, tier: 'ultra' }],
      ['no organization', { ...validPayload, org: '' }],
      ['no id', { ...validPayload, id: '' }],
      ['a fractional seat count', { ...validPayload, seats: 2.5 }],
      ['a negative seat count', { ...validPayload, seats: -1 }],
      ['an unparseable issue date', { ...validPayload, iat: 'whenever' }],
      ['non-string features', { ...validPayload, features: [1, 2] }],
    ])('rejects %s even when correctly signed', (_label, payload) => {
      const key = authority.issue(payload);
      expect(verifyLicense(key, { publicKey: authority.publicKey })).toMatchObject({
        valid: false,
        failure: 'invalid-payload',
      });
    });

    it('rejects a future format version with an upgrade hint', () => {
      const key = authority.issue({ ...validPayload, v: 2 });
      // The version lives in the key prefix too, so build one that claims v2.
      const claimed = key.replace('ANCHOR-1-', 'ANCHOR-2-');
      const result = verifyLicense(claimed, { publicKey: authority.publicKey });

      expect(result).toMatchObject({ valid: false, failure: 'unsupported-version' });
      if (!result.valid) expect(result.message).toContain('Upgrade Anchor');
    });
  });

  describe('expiry', () => {
    it('rejects a license past its date', () => {
      const key = authority.issue({ ...validPayload, exp: '2026-06-01T00:00:00.000Z' });
      const result = verifyLicense(key, {
        publicKey: authority.publicKey,
        now: new Date('2027-01-01T00:00:00.000Z'),
      });

      expect(result).toMatchObject({ valid: false, failure: 'expired' });
      // The wording matters: expiry must not read like the tool stopped working.
      if (!result.valid) expect(result.message).toContain('every feature is free');
    });

    it('accepts a license still within its date', () => {
      const key = authority.issue({ ...validPayload, exp: '2030-01-01T00:00:00.000Z' });
      expect(
        verifyLicense(key, {
          publicKey: authority.publicKey,
          now: new Date('2027-01-01T00:00:00.000Z'),
        }).valid,
      ).toBe(true);
    });
  });

  describe('the shipped build', () => {
    it('has a placeholder public key, so no license can verify yet', () => {
      expect(PRODUCTION_PUBLIC_KEY_SPKI_B64).toContain('PLACEHOLDER');
      expect(publicKeyFrom(PRODUCTION_PUBLIC_KEY_SPKI_B64)).toBeNull();
    });

    it('refuses every key rather than accepting a forged one', () => {
      // The safe failure direction: no key compiled in means nothing verifies.
      const authority2 = makeAuthority();
      const result = verifyLicense(authority2.issue(validPayload));

      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.message).toContain('Every feature is free');
    });
  });

  describe('key format stability', () => {
    it('still verifies a license signed before the current code was written', () => {
      // If the encoding, prefix or signed byte range ever changes, this fails.
      const result = verifyLicense(FIXTURE_LICENSE_KEY, { publicKey: FIXTURE_PUBLIC_KEY });

      expect(result.valid).toBe(true);
      if (result.valid) expect(result.license).toEqual(FIXTURE_LICENSE);
    });
  });

  it('round-trips through the exported encoding helpers', () => {
    const encoded = encodeLicensePayload(validPayload);
    expect(encodeBase64Url(Buffer.from('hi'))).not.toContain('=');
    expect(formatLicenseKey(encoded, Buffer.from('sig'))).toMatch(/^ANCHOR-1-/);
  });
});

describe('getEntitlements', () => {
  const authority = makeAuthority();

  describe('nothing is gated today', () => {
    it('gives an unlicensed user every feature', () => {
      const entitlements = getEntitlements();

      expect(entitlements.tier).toBe('free');
      for (const feature of FEATURES) {
        expect(hasFeature(entitlements, feature), feature).toBe(true);
      }
    });

    it('gives a licensed user exactly the same features', () => {
      // The seam must not have quietly started gating anything.
      const licensed = getEntitlements({
        licenseKey: authority.issue(validPayload),
        publicKey: authority.publicKey,
      });

      expect([...licensed.features].sort()).toEqual([...FREE_FEATURES].sort());
    });

    it('promises the free tier every feature the product has', () => {
      expect([...FREE_FEATURES].sort()).toEqual([...FEATURES].sort());
    });
  });

  describe('license resolution', () => {
    it('reads a key from config', () => {
      const entitlements = getEntitlements({
        licenseKey: authority.issue(validPayload),
        publicKey: authority.publicKey,
      });

      expect(entitlements.tier).toBe('team');
      expect(entitlements.seats).toBe(25);
      expect(entitlements.license?.organization).toBe('Acme Inc');
    });

    it('reads a key from the environment', () => {
      const entitlements = getEntitlements({
        env: { ANCHOR_LICENSE_KEY: authority.issue(validPayload) },
        publicKey: authority.publicKey,
      });

      expect(entitlements.tier).toBe('team');
    });

    it('prefers config over the environment, like every other setting', () => {
      const entitlements = getEntitlements({
        licenseKey: authority.issue({ ...validPayload, org: 'From Config' }),
        env: { ANCHOR_LICENSE_KEY: authority.issue({ ...validPayload, org: 'From Env' }) },
        publicKey: authority.publicKey,
      });

      expect(entitlements.license?.organization).toBe('From Config');
    });

    it('ignores an empty or whitespace key', () => {
      expect(getEntitlements({ licenseKey: '   ' }).tier).toBe('free');
      expect(getEntitlements({ env: { ANCHOR_LICENSE_KEY: '' } }).tier).toBe('free');
    });
  });

  describe('a license that cannot be used', () => {
    it('never costs the user anything they already had', () => {
      const entitlements = getEntitlements({
        licenseKey: 'ANCHOR-1-garbage.garbage',
        publicKey: authority.publicKey,
      });

      expect(entitlements.tier).toBe('free');
      expect([...entitlements.features].sort()).toEqual([...FREE_FEATURES].sort());
    });

    it('explains itself, so a paying customer is not left guessing', () => {
      const expired = authority.issue({ ...validPayload, exp: '2026-01-02T00:00:00.000Z' });
      const entitlements = getEntitlements({
        licenseKey: expired,
        publicKey: authority.publicKey,
        now: new Date('2027-01-01T00:00:00.000Z'),
      });

      expect(entitlements.problem).toContain('expired');
    });

    it('reports no problem when there was no license to begin with', () => {
      expect(getEntitlements().problem).toBeUndefined();
    });
  });
});

describe('describeEntitlements', () => {
  const authority = makeAuthority();

  it('says nothing for an unlicensed user', () => {
    expect(describeEntitlements(getEntitlements())).toBeNull();
  });

  it('summarizes a license in one line', () => {
    const entitlements = getEntitlements({
      licenseKey: authority.issue(validPayload),
      publicKey: authority.publicKey,
    });

    expect(describeEntitlements(entitlements)).toBe(
      'team license · Acme Inc · 25 seats · through 2030-01-01',
    );
  });

  it('describes a perpetual unlimited license', () => {
    const entitlements = getEntitlements({
      licenseKey: authority.issue({ ...validPayload, seats: null, exp: null }),
      publicKey: authority.publicKey,
    });

    expect(describeEntitlements(entitlements)).toContain('unlimited seats · perpetual');
  });
});
