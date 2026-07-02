import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '../server/auth';

describe('impersonation session claims', () => {
  it('carries impersonatedBy through the signed token round-trip', () => {
    const token = createSessionToken(
      { username: 'winemaker_1', role: 'Winemaker', impersonatedBy: 'master@admin' },
      false,
    );
    const session = verifySessionToken(token);
    expect(session.username).toBe('winemaker_1');
    expect(session.role).toBe('Winemaker');
    expect(session.impersonatedBy).toBe('master@admin');
  });

  it('a normal session has no impersonatedBy claim', () => {
    const token = createSessionToken({ username: 'winemaker_1', role: 'Winemaker' }, false);
    const session = verifySessionToken(token);
    expect(session.impersonatedBy).toBeUndefined();
  });

  it('tampering with the payload invalidates the token (claim cannot be forged)', () => {
    const token = createSessionToken({ username: 'winemaker_1', role: 'Winemaker' }, false);
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    decoded.impersonatedBy = 'master@admin'; // attacker grants themselves the claim
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64') + '.' + signature;
    expect(verifySessionToken(forged)).toBeNull();
  });
});
