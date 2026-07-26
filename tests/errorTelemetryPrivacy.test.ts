import { describe, expect, it } from 'vitest';
import { privacySafeErrorLocation } from '../src/errorTelemetry';

describe('client crash telemetry privacy', () => {
  it('retains only the top-level destination and removes tokens or record identifiers', () => {
    expect(privacySafeErrorLocation('/reset-password/private-token?next=/tasks')).toBe('/reset-password');
    expect(privacySafeErrorLocation('/lots/LOT-SECRET-001')).toBe('/lots');
    expect(privacySafeErrorLocation('/')).toBe('/');
  });
});
