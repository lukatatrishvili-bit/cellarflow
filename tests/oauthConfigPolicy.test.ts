import { describe, expect, it } from 'vitest';
import { isRuntimeOAuthConfigAllowed, oauthConfigBlockedMessage } from '../server/oauthConfigPolicy';

describe('OAuth runtime configuration policy', () => {
  it('allows runtime OAuth setup outside production for local development', () => {
    expect(isRuntimeOAuthConfigAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(isRuntimeOAuthConfigAllowed({})).toBe(true);
  });

  it('blocks runtime OAuth setup in production by default', () => {
    expect(isRuntimeOAuthConfigAllowed({ NODE_ENV: 'production' })).toBe(false);
  });

  it('allows an explicit production maintenance override', () => {
    expect(isRuntimeOAuthConfigAllowed({
      NODE_ENV: 'production',
      ALLOW_RUNTIME_OAUTH_CONFIG: 'true',
    })).toBe(true);
  });

  it('uses a clear production-safe blocked message', () => {
    expect(oauthConfigBlockedMessage()).toContain('Secret Manager');
    expect(oauthConfigBlockedMessage()).toContain('GOOGLE_CLIENT_ID');
  });
});
