import { describe, it, expect } from 'vitest';
import {
  generateVerificationToken, hashToken, isVerificationTokenValid, isValidEmail, VERIFICATION_TTL_MS,
} from '../server/emailVerification';

describe('email verification tokens', () => {
  it('generates a raw token plus a stored hash and future expiry', () => {
    const now = 1_000_000;
    const v = generateVerificationToken(now);
    expect(v.token).toMatch(/^[a-f0-9]{64}$/);
    expect(v.tokenHash).toBe(hashToken(v.token));
    expect(v.token).not.toBe(v.tokenHash); // the raw token is never what we store
    expect(v.expiresAt).toBe(now + VERIFICATION_TTL_MS);
  });

  it('accepts a matching, unexpired token', () => {
    const now = 1_000_000;
    const v = generateVerificationToken(now);
    const record = { verifyTokenHash: v.tokenHash, verifyTokenExpires: v.expiresAt };
    expect(isVerificationTokenValid(record, v.token, now + 1000)).toBe(true);
  });

  it('rejects a wrong token, an expired token, and missing data', () => {
    const now = 1_000_000;
    const v = generateVerificationToken(now);
    const record = { verifyTokenHash: v.tokenHash, verifyTokenExpires: v.expiresAt };
    expect(isVerificationTokenValid(record, 'deadbeef', now)).toBe(false);
    expect(isVerificationTokenValid(record, v.token, v.expiresAt + 1)).toBe(false); // expired
    expect(isVerificationTokenValid(null, v.token, now)).toBe(false);
    expect(isVerificationTokenValid(record, undefined, now)).toBe(false);
    expect(isVerificationTokenValid({}, v.token, now)).toBe(false);
  });

  it('validates email format', () => {
    expect(isValidEmail('winemaker@marani.ge')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('two@@at.com')).toBe(false);
    expect(isValidEmail('spaces in@x.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});
