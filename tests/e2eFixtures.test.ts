import { describe, expect, it } from 'vitest';
import { e2eFixturesAreAllowed } from '../server/e2eFixtures';

describe('browser release fixture policy', () => {
  it('requires an explicit non-production E2E process', () => {
    expect(e2eFixturesAreAllowed({
      NODE_ENV: 'development',
      E2E_TEST_MODE: 'true',
    })).toBe(true);
    expect(e2eFixturesAreAllowed({
      NODE_ENV: 'development',
      E2E_TEST_MODE: 'false',
    })).toBe(false);
    expect(e2eFixturesAreAllowed({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'true',
    })).toBe(false);
  });
});
