import { afterEach, describe, expect, it } from 'vitest';
import { openBillingToken, sealBillingToken } from '../server/billing/tokenSeal';

const originalSecret = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = originalSecret;
});

describe('billing recurring-token sealing', () => {
  it('encrypts provider recurring identifiers and detects tampering', () => {
    process.env.SESSION_SECRET = 'billing-token-test-secret-that-is-at-least-32-bytes';
    const sealed = sealBillingToken('tbc-recurring-id');

    expect(sealed).not.toContain('tbc-recurring-id');
    expect(openBillingToken(sealed)).toBe('tbc-recurring-id');
    expect(openBillingToken(`${sealed.slice(0, -2)}xx`)).toBeNull();
  });
});
