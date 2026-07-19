import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import {
  hashPassword,
  verifyPassword,
  passwordNeedsUpgrade,
  createSessionToken,
  verifySessionToken,
  resolveSessionSecret,
  passcodeValidationError,
  MIN_PASSCODE_LENGTH,
  MAX_PASSCODE_LENGTH,
  sameNormalizedEmail,
  sessionMatchesUserVersion,
  sessionPayloadForUser,
  sessionVersionForUser,
  userAccountIsEnabled,
} from '../server/auth';

/** Reproduce the pre-2026 `salt:hash` format at 10,000 PBKDF2 iterations. */
function legacyHash(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

describe('password hashing', () => {
  it('hashes and verifies a new password with the current parameters', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored.split(':')).toHaveLength(3);
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('still verifies a legacy salt:hash (10k iteration) password', () => {
    const stored = legacyHash('old-secret');
    expect(verifyPassword('old-secret', stored)).toBe(true);
    expect(verifyPassword('nope', stored)).toBe(false);
  });

  it('flags legacy hashes for upgrade but not freshly created ones', () => {
    expect(passwordNeedsUpgrade(legacyHash('x'))).toBe(true);
    expect(passwordNeedsUpgrade(hashPassword('x'))).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'a:b:c:d')).toBe(false);
  });
});

describe('passcode policy', () => {
  it('accepts passphrases within the shared length bounds', () => {
    expect(passcodeValidationError('vintage-2026')).toBeNull();
    expect(passcodeValidationError('x'.repeat(MIN_PASSCODE_LENGTH))).toBeNull();
    expect(passcodeValidationError('x'.repeat(MAX_PASSCODE_LENGTH))).toBeNull();
  });

  it('rejects short, oversized, and non-string passcodes', () => {
    expect(passcodeValidationError('short')).toMatch(/at least/);
    expect(passcodeValidationError('x'.repeat(MAX_PASSCODE_LENGTH + 1))).toMatch(/at most/);
    expect(passcodeValidationError(undefined)).toMatch(/at least/);
  });
});

describe('invitation email binding', () => {
  it('matches invited accounts case-insensitively after trimming', () => {
    expect(sameNormalizedEmail(' Cellar@Example.com ', 'cellar@example.com')).toBe(true);
  });

  it('rejects different or missing account emails', () => {
    expect(sameNormalizedEmail('owner@example.com', 'worker@example.com')).toBe(false);
    expect(sameNormalizedEmail('', '')).toBe(false);
    expect(sameNormalizedEmail(undefined, 'worker@example.com')).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a valid signed token', () => {
    const token = createSessionToken({ username: 'alice', role: 'Owner/Admin' });
    const payload = verifySessionToken(token);
    expect(payload?.username).toBe('alice');
    expect(payload?.role).toBe('Owner/Admin');
  });

  it('rejects a token with a tampered signature', () => {
    const token = createSessionToken({ username: 'alice' });
    const [body] = token.split('.');
    const forged = `${body}.deadbeef`;
    expect(verifySessionToken(forged)).toBeNull();
  });

  it('rejects a token with a tampered payload', () => {
    const token = createSessionToken({ username: 'alice', role: 'Read-Only' });
    const [, signature] = token.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ username: 'alice', role: 'Owner/Admin', expiresAt: Date.now() + 100000 }),
    ).toString('base64');
    expect(verifySessionToken(`${forgedBody}.${signature}`)).toBeNull();
  });

  it('rejects empty and malformed tokens', () => {
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('no-dot')).toBeNull();
  });

  it('binds new sessions to the current server-side session version', () => {
    const user = { username: 'alice', sessionVersion: 3 };
    const token = createSessionToken(sessionPayloadForUser(user, 'Winemaker'));
    const payload = verifySessionToken(token);

    expect(payload.sessionVersion).toBe(3);
    expect(sessionMatchesUserVersion(payload, user)).toBe(true);
    expect(sessionMatchesUserVersion(payload, { ...user, sessionVersion: 4 })).toBe(false);
  });

  it('treats legacy versionless users and sessions as version one', () => {
    expect(sessionVersionForUser({ username: 'legacy' })).toBe(1);
    expect(sessionMatchesUserVersion({ username: 'legacy' }, { username: 'legacy' })).toBe(true);
    expect(sessionMatchesUserVersion({ username: 'legacy' }, { username: 'legacy', sessionVersion: 2 })).toBe(false);
  });

  it('defaults legacy accounts to enabled but honors an explicit disable', () => {
    expect(userAccountIsEnabled({ username: 'legacy' })).toBe(true);
    expect(userAccountIsEnabled({ username: 'disabled', accountEnabled: false })).toBe(false);
  });
});

describe('resolveSessionSecret', () => {
  const original = { NODE_ENV: process.env.NODE_ENV, SESSION_SECRET: process.env.SESSION_SECRET };

  afterEach(() => {
    process.env.NODE_ENV = original.NODE_ENV;
    if (original.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original.SESSION_SECRET;
  });

  it('returns the configured secret when set', () => {
    process.env.SESSION_SECRET = 'a-real-secret';
    expect(resolveSessionSecret()).toBe('a-real-secret');
  });

  it('throws in production when the secret is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;
    expect(() => resolveSessionSecret()).toThrow(/SESSION_SECRET must be set/);
  });

  it('falls back to a dev-only secret outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SESSION_SECRET;
    expect(resolveSessionSecret()).toContain('dev-only');
  });
});
