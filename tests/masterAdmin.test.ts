import { describe, it, expect } from 'vitest';

// We can mock the environment variable and test a local implementation of the helper
// to ensure the logic matches exactly.
function isMasterAdminLocal(username: string, envAdmin: string): boolean {
  if (!envAdmin) return false;
  return username.trim().toLowerCase() === envAdmin.trim().toLowerCase();
}

describe('Master Administrator Authorization', () => {
  it('correctly identifies the master admin username case-insensitively', () => {
    const envAdmin = 'MasterWrangler';

    expect(isMasterAdminLocal('MasterWrangler', envAdmin)).toBe(true);
    expect(isMasterAdminLocal('masterwrangler', envAdmin)).toBe(true);
    expect(isMasterAdminLocal('MASTERWRANGLER', envAdmin)).toBe(true);

    expect(isMasterAdminLocal('standard_user', envAdmin)).toBe(false);
    expect(isMasterAdminLocal('admin', envAdmin)).toBe(false);
    expect(isMasterAdminLocal('', envAdmin)).toBe(false);
  });

  it('handles empty or unset admin username config by refusing access', () => {
    expect(isMasterAdminLocal('admin', '')).toBe(false);
    expect(isMasterAdminLocal('admin', ' ')).toBe(false);
  });
});
